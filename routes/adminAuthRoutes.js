const express = require("express");
const {
  signupAdmin,
  loginAdmin,
  getAdminProfile,
  changeAdminPassword,
} = require("../controllers/adminAuthController");
const { authenticateAdmin } = require("../middleware/auth");

const router = express.Router();

router.post("/signup", signupAdmin);
router.post("/login", loginAdmin);
router.get("/me", authenticateAdmin, getAdminProfile);
router.put("/change-password", authenticateAdmin, changeAdminPassword);

module.exports = router;
