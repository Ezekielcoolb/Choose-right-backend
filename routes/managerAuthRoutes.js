const express = require("express");
const {
  loginManager,
  getManagerProfile,
  changeManagerPassword,
  forgotPassword,
} = require("../controllers/managerAuthController");
const { authenticateManager } = require("../middleware/auth");

const router = express.Router();

router.post("/login", loginManager);
router.get("/me", authenticateManager, getManagerProfile);
router.post("/change-password", authenticateManager, changeManagerPassword);
router.post("/forgot-password", forgotPassword);

module.exports = router;
