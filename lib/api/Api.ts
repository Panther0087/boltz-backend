import cors from 'cors';
import express, { Application, Request, Response, NextFunction } from 'express';
import Logger from '../Logger';
import Controller from './Controller';
import { ApiConfig } from '../Config';
import Service from '../service/Service';

class Api {
  private app: Application;
  private readonly controller: Controller;

  constructor(private logger: Logger, private config: ApiConfig, service: Service) {
    this.app = express();
    this.controller = new Controller(logger, service);

    this.app.use(cors());
    this.app.use(express.json());

    // Catch the ugly errors generated by the body-parser
    this.app.use((error: any, req: Request, res: Response, next: NextFunction) => {
      if (error instanceof SyntaxError) {
        this.controller.errorResponse(req, res, error);
        return;
      }

      next();
    });

    this.registerRoutes(this.controller);
  }

  public init = async (): Promise<void> => {
    await this.controller.init();

    await new Promise((resolve) => {
      this.app.listen(this.config.port, this.config.host, () => {
        this.logger.info(`API server listening on: ${this.config.host}:${this.config.port}`);
        resolve();
      });
    });
  }

  private registerRoutes = (controller: Controller) => {
    // GET requests
    this.app.route('/version').get(controller.version);

    this.app.route('/getpairs').get(controller.getPairs);
    this.app.route('/getnodes').get(controller.getNodes);
    this.app.route('/getcontracts').get(controller.getContracts);
    this.app.route('/getfeeestimation').get(controller.getFeeEstimation);

    // POST requests
    this.app.route('/swapstatus').post(controller.swapStatus);
    this.app.route('/swaprates').post(controller.swapRates);

    this.app.route('/gettransaction').post(controller.getTransaction);
    this.app.route('/getswaptransaction').post(controller.getSwapTransaction);
    this.app.route('/broadcasttransaction').post(controller.broadcastTransaction);

    this.app.route('/createswap').post(controller.createSwap);
    this.app.route('/setinvoice').post(controller.setInvoice);

    // EventSource streams
    this.app.route('/streamswapstatus').get(controller.streamSwapStatus);
  }
}

export default Api;
export { ApiConfig };
