const express = require('express');
const { getMaintenance } = require('../controllers/maintenanceController');

const router = express.Router();

/**
 * One route, PUBLIC, and read-only.
 *
 * Public because the maintenance screen has to reach the login screen — during
 * a deployment, signing in is precisely what will not work.
 *
 * Read-only because the switch is set by hand in the database. There is no POST
 * here and there should never be one: an endpoint that can take every store
 * build offline is not something to expose over HTTP for the sake of saving a
 * trip to Atlas a few times a year. See models/AppMaintenance.js.
 */
router.get('/', getMaintenance);

module.exports = router;
