const express = require("express");
const {
  listAdminMembers,
  getAdminMember,
  createAdminMember,
  updateAdminMember,
  toggleSuspendMember,
  deleteAdminMember,
} = require("../controllers/adminPanelController");

const {
  getDashboardOverview,
  getDashboardInsights,
  getDashboardRecent,
} = require("../controllers/adminDashboardController");

const router = express.Router();

router.get("/", listAdminMembers);
router.post("/", createAdminMember);
router.get("/dashboard/overview", getDashboardOverview);
router.get("/dashboard/insights", getDashboardInsights);
router.get("/dashboard/recent", getDashboardRecent);
router.get("/:id", getAdminMember);
router.put("/:id", updateAdminMember);
router.patch("/:id/suspend", toggleSuspendMember);
router.delete("/:id", deleteAdminMember);

module.exports = router;
