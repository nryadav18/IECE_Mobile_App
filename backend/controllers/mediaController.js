const mongoose = require('mongoose');
const Media = require('../models/Media');
const { purgeAssets, purgeSummary, purgeProblem } = require('../utils/cloudinary');
const { decisionOf, trail } = require('../utils/approvalTrail');
const { ADMIN_ROLES } = require('../utils/roles');

/**
 * The "Invisible to" list as it can safely be stored: real user ids, no
 * duplicates, nothing else. Anything unrecognisable is dropped rather than
 * rejected — a malformed entry should never cost the admin the whole upload.
 */
const normalizeHiddenFor = (value) => {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((v) => (v && typeof v === 'object' ? v._id : v))
    .map((v) => (v == null ? '' : String(v)))
    .filter((v) => mongoose.Types.ObjectId.isValid(v));
  return [...new Set(ids)];
};

exports.getMedia = async (req, res) => {
  try {
    let query = {};
    if (req.user.role !== 'chairman') {
      query.status = 'approved';
    }

    // The Banners tab manages every banner, including the ones its own admin is
    // excluded from — otherwise a banner could become invisible to the only
    // person able to edit or delete it. Every other caller (the Home carousel)
    // gets the audience-filtered list.
    const manage = req.query.scope === 'manage' && ADMIN_ROLES.includes(req.user.role);
    if (!manage) {
      if (req.user.role === 'chairman') {
        // The chairman is the approver. A banner still waiting on their decision
        // has to reach them even if it was marked invisible to them, or it could
        // never be decided at all; once it is live the exclusion applies as normal.
        query.$or = [{ hiddenFor: { $ne: req.user.id } }, { status: 'pending' }];
      } else {
        query.hiddenFor = { $ne: req.user.id };
      }
    }

    let find = Media.find(query).populate('uploaderId', 'name').sort('-createdAt');
    // Who a banner is withheld from is the Admin's business alone — it is never
    // sent to the people it is about, not even as bare ids.
    find = manage ? find.populate('hiddenFor', 'name email role') : find.select('-hiddenFor');

    const media = await find;
    res.status(200).json({ success: true, count: media.length, data: media });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.createMedia = async (req, res) => {
  try {
    req.body.uploaderId = req.user.id;
    // Whoever the uploader picked in "Invisible to", cleaned up. Absent field →
    // empty list → the banner is public, exactly as it was before this existed.
    req.body.hiddenFor = normalizeHiddenFor(req.body.hiddenFor);
    // Set status to pending by default for team leaders, but approved for admins
    req.body.status = req.user.role === 'creator_admin' ? 'approved' : 'pending';
    // An admin upload skips the queue, so the admin who uploaded it is also the
    // one who effectively approved it.
    req.body.decidedBy =
      req.body.status === 'approved' ? decisionOf(req.user, 'auto_approved') : null;

    const media = await Media.create(req.body);
    res.status(201).json({ success: true, data: media });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

/**
 * Edit a banner already on the wall — its description and its audience.
 *
 * Only these two fields are editable. The image itself is not: replacing it
 * would leave the old Cloudinary asset orphaned and the approval that was given
 * to a different picture still attached, so a new picture means a new banner.
 */
exports.updateMedia = async (req, res) => {
  try {
    const update = {};
    if (typeof req.body.description === 'string') {
      const description = req.body.description.trim();
      if (!description) {
        return res.status(400).json({ success: false, error: 'Description cannot be empty' });
      }
      update.description = description;
    }
    if (req.body.hiddenFor !== undefined) {
      update.hiddenFor = normalizeHiddenFor(req.body.hiddenFor);
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, error: 'Nothing to update' });
    }

    const media = await Media.findByIdAndUpdate(req.params.id, update, {
      returnDocument: 'after',
      runValidators: true,
    })
      .populate('uploaderId', 'name')
      .populate('hiddenFor', 'name email role');

    if (!media) {
      return res.status(404).json({ success: false, error: 'Media not found' });
    }

    res.status(200).json({ success: true, data: media });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.updateMediaStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const decidedAt = new Date();
    const media = await Media.findByIdAndUpdate(
      req.params.id,
      { status, decidedBy: decisionOf(req.user, status, decidedAt) },
      { returnDocument: 'after', runValidators: true }
    ).populate('uploaderId', 'name role');

    if (!media) {
      return res.status(404).json({ success: false, error: 'Media not found' });
    }

    res.status(200).json({ success: true, data: media });

    trail({
      entityType: 'media',
      entityId: media._id,
      entityLabel: media.description || 'Gallery item',
      subject: media.uploaderId,
      actor: req.user,
      action: status,
      at: decidedAt,
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

exports.deleteMedia = async (req, res) => {
  try {
    // Populated for the Approval Log — the row snapshots the uploader's name,
    // and after deleteOne() there is nothing left to read it from.
    const media = await Media.findById(req.params.id).populate('uploaderId', 'name role');
    if (!media) {
      return res.status(404).json({ success: false, error: 'Media not found' });
    }

    // The image goes FIRST, and the banner row only goes if it did. Deleting
    // the row first would throw away the one reference to the file, leaving it
    // in the Cloudinary account with nothing left that knows its name. The old
    // code fired the deletion and ignored the answer, so a failure here was
    // completely silent.
    const purge = await purgeAssets([media.imageUrl]);
    if (!purge.ok) {
      return res.status(502).json({
        success: false,
        error: `The banner was NOT deleted. ${purgeProblem(purge)}`,
        cloud: { deleted: purge.deleted, failed: purge.failed },
      });
    }

    const deletedAt = new Date();
    await media.deleteOne();
    res.status(200).json({
      success: true,
      data: {},
      message: `Banner deleted. ${purgeSummary(purge)}`,
      cloud: { deleted: purge.deleted, missing: purge.missing, failed: 0 },
    });

    trail({
      entityType: 'media',
      entityId: media._id,
      entityLabel: media.description || 'Gallery item',
      subject: media.uploaderId,
      actor: req.user,
      action: 'deleted',
      note: `Banner deleted and its image removed from cloud storage. ${purgeSummary(purge)}`,
      at: deletedAt,
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};
