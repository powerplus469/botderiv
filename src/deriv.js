const WebSocket = require("ws");

const logger = require("./logger");

const config = require("./config");

class DerivClient {

    constructor() {

        this.ws = null;

        this.connected = false;

    }

    connect() {

        this.ws = new WebSocket(
            `wss://ws.derivws.com/websockets/v3?app_id=${config.APP_ID}`
        );

        this.ws.on("open", () => {

            logger.info("Connexion à Deriv...");

            this.authorize();

        });

        this.ws.on("message", (msg) => {

            const data = JSON.parse(msg);

            this.handleMessage(data);

        });

        this.ws.on("close", () => {

            logger.warn("Connexion perdue.");

            this.connected = false;

            setTimeout(() => {

                logger.info("Reconnexion...");

                this.connect();

            }, 5000);

        });

        this.ws.on("error", (err) => {

            logger.error(err.message);

        });

    }

    authorize() {

        this.send({

            authorize: config.TOKEN

        });

    }

    send(data) {

        this.ws.send(JSON.stringify(data));

    }

    handleMessage(data) {

        switch (data.msg_type) {

            case "authorize":

                logger.info("Authentification réussie.");

                this.connected = true;

                break;

            default:

                logger.info(JSON.stringify(data));

        }

    }

}

module.exports = DerivClient;
