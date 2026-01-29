const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "development-secret";

exports.authenticateCso = (req, res, next) => {
  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authentication required" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.csoId = payload.sub;
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
