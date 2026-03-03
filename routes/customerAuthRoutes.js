const express = require("express");
const {
  loginCustomer,
  getCustomerProfile,
  changeCustomerPassword,
  forgotPassword,
} = require("../controllers/customerAuthController");
const { authenticateCustomer } = require("../middleware/auth");

const router = express.Router();

router.post("/login", loginCustomer);
router.post("/forgot-password", forgotPassword);
router.get("/profile", authenticateCustomer, getCustomerProfile);
router.post("/change-password", authenticateCustomer, changeCustomerPassword);

module.exports = router;
