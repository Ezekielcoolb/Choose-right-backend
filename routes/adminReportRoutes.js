const express = require("express");
const { getFeeReport } = require("../controllers/adminReportController");

const router = express.Router();

router.get("/maintenance-fees", getFeeReport);

module.exports = router;
