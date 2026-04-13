/**
 * Stock Service Initializer
 * Service initialization and health checking
 */

export interface StockServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    stockService: boolean;
    queryService: boolean;
    commandService: boolean;
    movementService: boolean;
  };
  database: boolean;
  lastCheck: Date;
}

/**
 * Initialize stock management services and verify health
 */
export const initializeStockServices = async (): Promise<{
  success: boolean;
  services: string[];
  healthStatus: StockServiceHealth;
}> => {
  try {
    const stockService = new (await import('../../StockService')).default();

    // Check health of all services
    const mainServiceHealth = await stockService.getHealthStatus();
    const stockOperations = new (await import('../../../api/stockOperations')).StockOperations();
    const operationsHealth = await stockOperations.getHealthStatus();

    const allHealthy = mainServiceHealth.success &&
                      operationsHealth.success &&
                      mainServiceHealth.data?.status === 'healthy' &&
                      operationsHealth.data?.status === 'healthy';

    const healthStatus: StockServiceHealth = {
      status: allHealthy ? 'healthy' : 'degraded',
      services: {
        stockService: mainServiceHealth.success,
        queryService: mainServiceHealth.success,
        commandService: mainServiceHealth.success,
        movementService: mainServiceHealth.success,
      },
      database: allHealthy,
      lastCheck: new Date(),
    };

    return {
      success: allHealthy,
      services: [
        'StockService',
        'StockQueryService',
        'StockCommandService',
        'StockMovementService',
        'StockOperations',
        'StockCalculations'
      ],
      healthStatus,
    };
  } catch (error) {
    return {
      success: false,
      services: [],
      healthStatus: {
        status: 'unhealthy',
        services: {
          stockService: false,
          queryService: false,
          commandService: false,
          movementService: false,
        },
        database: false,
        lastCheck: new Date(),
      },
    };
  }
};

/**
 * Create a stock service instance with default configuration
 */
export const createStockService = async () => {
  const { default: StockService } = await import('../../StockService');
  return new StockService();
};

/**
 * Create stock operations instance for API use
 */
export const createStockOperations = async () => {
  const { StockOperations } = await import('../../../api/stockOperations');
  return new StockOperations();
};
