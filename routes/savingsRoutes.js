const express = require("express");
const {
  createPlan,
  createPlanForCustomer,
  getPlans,
  getPlanById,
  recordDeposit,
  recordWithdrawal,
  updatePlanStatus,
  getPlanEntries,
  requestLoan,
  approveLoan,
  rejectLoan,
  createWithdrawalRequest,
  getWithdrawalRequestsForPlan,
} = require("../controllers/savingsPlanController");
const { authenticateCso } = require("../middleware/auth");

const router = express.Router();

router.use(authenticateCso);

router.route("/").get(getPlans).post(createPlan);

router.post("/customer/:id", createPlanForCustomer);

router.route("/:id").get(getPlanById).patch(updatePlanStatus);

router.post("/:id/deposits", recordDeposit);
router.post("/:id/withdrawals", recordWithdrawal);
router.post("/:id/withdrawals/request", createWithdrawalRequest);
router.get("/:id/withdrawals/requests", getWithdrawalRequestsForPlan);
router.get("/:id/entries", getPlanEntries);

router.post("/:id/loan/request", requestLoan);
router.put("/:id/loan/approve", approveLoan);
router.put("/:id/loan/reject", rejectLoan);

module.exports = router;
