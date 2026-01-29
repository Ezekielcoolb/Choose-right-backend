const express = require("express");
const {
  loginCso,
  getCsoProfile,
  changeCsoPassword,
} = require("../controllers/csoAuthController");
const { authenticateCso } = require("../middleware/auth");

const router = express.Router();

router.post("/login", loginCso);
router.get("/me", authenticateCso, getCsoProfile);
router.post("/change-password", authenticateCso, changeCsoPassword);

module.exports = router;
