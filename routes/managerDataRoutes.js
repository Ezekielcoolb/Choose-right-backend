const express = require("express");
const {
  getManagerDashboardOverview,
  getManagerDashboardInsights,
  getManagerDashboardRecent,
  getManagedCsos,
  getManagedCustomers,
  getManagedSavingsPlans,
  getManagedLoans,
  getManagedTransactions,
  getManagedRemittances,
  getManagerCsoDetail,
  getManagedCustomerDetail,
  getManagedPlanEntries,
  resolveRemittance,
} = require("../controllers/managerDataController");
const { authenticateManager } = require("../middleware/auth");

const router = express.Router();

router.use(authenticateManager);

router.get("/dashboard/overview", getManagerDashboardOverview);
router.get("/dashboard/insights", getManagerDashboardInsights);
router.get("/dashboard/recent", getManagerDashboardRecent);
router.get("/csos", getManagedCsos);
router.get("/customers", getManagedCustomers);
router.get("/savings", getManagedSavingsPlans);
router.get("/loans", getManagedLoans);
router.get("/transactions", getManagedTransactions);
router.get("/remittances", getManagedRemittances);
router.get("/csos/:id/detail", getManagerCsoDetail);
router.get("/customers/:id", getManagedCustomerDetail);
router.get(
  "/customers/:customerId/plans/:planId/entries",
  getManagedPlanEntries,
);

router.post("/csos/:csoId/remittance/:remittanceId/resolve", resolveRemittance);

module.exports = router;
