const express = require("express");
const { getCsoDetail } = require("../controllers/adminCsoController");

const router = express.Router();

router.get("/:id/detail", getCsoDetail);

module.exports = router;
