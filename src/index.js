const DerivClient = require("./deriv");

const logger = require("./logger");

logger.info("===== BOT DERIV DEMARRÉ =====");

const bot = new DerivClient();

bot.connect();
