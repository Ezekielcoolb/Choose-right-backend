const express = require("express");
const {
  getPendingLoans,
  getActiveLoans,
  approveLoan,
  rejectLoan,
} = require("../controllers/adminLoanController");

const router = express.Router();

// Pending Loans (Disbursements)
router.get("/pending", getPendingLoans);

// Active Loans
router.get("/active", getActiveLoans);

// Actions
router.put("/:id/approve", approveLoan);
router.put("/:id/reject", rejectLoan);

module.exports = router;
