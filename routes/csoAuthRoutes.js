const express = require("express");
const {
  loginCso,
  getCsoProfile,
  getDashboardDetail,
  changeCsoPassword,
  forgotPassword,
} = require("../controllers/csoAuthController");
const { authenticateCso } = require("../middleware/auth");

const router = express.Router();

router.post("/login", loginCso);
router.post("/forgot-password", forgotPassword);
router.get("/me", authenticateCso, getCsoProfile);
router.get("/dashboard-detail", authenticateCso, getDashboardDetail);
router.post("/change-password", authenticateCso, changeCsoPassword);

module.exports = router;
