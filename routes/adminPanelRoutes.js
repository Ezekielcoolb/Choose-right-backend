const express = require("express");
const {
  listAdminMembers,
  getAdminMember,
  createAdminMember,
  updateAdminMember,
  toggleSuspendMember,
} = require("../controllers/adminPanelController");

const router = express.Router();

router.get("/", listAdminMembers);
router.post("/", createAdminMember);
router.get("/:id", getAdminMember);
router.put("/:id", updateAdminMember);
router.patch("/:id/suspend", toggleSuspendMember);

module.exports = router;
