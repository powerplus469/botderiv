require("dotenv").config();

module.exports = {
    APP_ID: process.env.APP_ID,
    TOKEN: process.env.DERIV_TOKEN,

    SYMBOL: process.env.SYMBOL || "R_100",

    STAKE: Number(process.env.STAKE || 1),

    CURRENCY: process.env.CURRENCY || "USD",

    CONTRACT_DURATION: Number(process.env.CONTRACT_DURATION || 1),
    DURATION_UNIT: process.env.DURATION_UNIT || "m",

    EMA_FAST: Number(process.env.EMA_FAST || 9),
    EMA_SLOW: Number(process.env.EMA_SLOW || 21),
    RSI_PERIOD: Number(process.env.RSI_PERIOD || 14),

    STOP_LOSS: Number(process.env.STOP_LOSS || 20),
    TAKE_PROFIT: Number(process.env.TAKE_PROFIT || 40)
};
