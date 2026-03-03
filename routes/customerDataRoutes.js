const express = require("express");
const {
  getMyPlans,
  getPlanDetails,
} = require("../controllers/customerDataController");
const { authenticateCustomer } = require("../middleware/auth");

const router = express.Router();

router.use(authenticateCustomer);

router.get("/plans", getMyPlans);
router.get("/plans/:planId", getPlanDetails);

module.exports = router;
