const express = require("express");
const {
  getWithdrawalRequests,
  approveWithdrawalRequest,
  rejectWithdrawalRequest,
} = require("../controllers/adminWithdrawalController");

const router = express.Router();

router.get("/", getWithdrawalRequests);
router.put("/:id/approve", approveWithdrawalRequest);
router.put("/:id/reject", rejectWithdrawalRequest);

module.exports = router;
