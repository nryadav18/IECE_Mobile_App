const express = require('express');
const { checkAppVersion } = require('../controllers/appVersionController');

const router = express.Router();

/**
 * One route, and it is PUBLIC by design.
 *
 * The update gate must be able to appear before anyone signs in — a build too
 * old to authenticate is precisely the one that needs telling. There is
 * nothing to configure and nothing to write: the released version is read from
 * `frontend/app.json`, so there are no admin endpoints here at all.
 */
router.get('/', checkAppVersion);

module.exports = router;
