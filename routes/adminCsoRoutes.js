const express = require("express");
const { getCsoDetail } = require("../controllers/adminCsoController");

const router = express.Router();

router.post(
  "/transfer-customers",
  require("../controllers/adminCsoController").transferCustomers,
);
router.get("/:id/detail", getCsoDetail);

module.exports = router;
