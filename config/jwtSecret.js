const DEFAULT_JWT_SECRET = "chooseRightSecret";

const resolvedSecret = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

if (!process.env.JWT_SECRET) {
  console.warn(
    "JWT_SECRET environment variable is missing. Falling back to an insecure development secret. Set JWT_SECRET in your .env file for production deployments."
  );
}

module.exports = resolvedSecret;
