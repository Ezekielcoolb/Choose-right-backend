const express = require("express");
const { getAllSavingsPlans } = require("../controllers/adminSavingsController");

const router = express.Router();

router.get("/", getAllSavingsPlans);

module.exports = router;
