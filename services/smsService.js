const axios = require("axios");

const sendSms = async (to, message) => {
  try {
    const TERMII_API_KEY = process.env.TERMII_API_KEY;
    const TERMII_SENDER_ID = process.env.TERMII_SENDER_ID;
    const TERMII_BASE_URL =
      process.env.TERMII_BASE_URL || "https://v3.api.termii.com";

    if (!TERMII_API_KEY || !TERMII_SENDER_ID) {
      console.error("SMS skip: Missing Termii credentials in .env");
      return null;
    }

    // Termii expects phone number in international format without +
    let formattedPhone = to.replace(/[^0-9]/g, "");
    if (formattedPhone.startsWith("0")) {
      formattedPhone = "234" + formattedPhone.slice(1);
    } else if (!formattedPhone.startsWith("234")) {
      // If it Doesn't start with 234 and doesn't start with 0, assume it needs 234 prefix
      // This depends on the region, assuming Nigeria for this project based on currency and sender ID
      formattedPhone = "234" + formattedPhone;
    }

    const payload = {
      to: formattedPhone,
      from: TERMII_SENDER_ID,
      sms: message,
      type: "plain",
      channel: "generic",
      api_key: TERMII_API_KEY,
    };

    const response = await axios.post(
      `${TERMII_BASE_URL}/api/sms/send`,
      payload,
    );
    console.log(`SMS Sent to ${formattedPhone}:`, response.data);
    return response.data;
  } catch (error) {
    console.error("SMS failed:", error.response?.data || error.message);
    return null;
  }
};

const sendPaymentNotification = async ({
  customerName,
  amount,
  planName,
  balance,
  phone,
}) => {
  const message = `Hello ${customerName}, your payment of ₦${amount.toLocaleString()} for ${planName} has been received. Current Balance: ₦${balance.toLocaleString()}. Thank you for choosing HI CHOOSE RIGHT NIG ENT.`;
  return sendSms(phone, message);
};

module.exports = {
  sendSms,
  sendPaymentNotification,
};
