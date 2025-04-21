// 负载均衡策略
const STRATEGIES = {
  ROUND_ROBIN: 'round-robin',
  RANDOM: 'random',
  LEAST_USED: 'least-used',
};

// 默认策略
const DEFAULT_STRATEGY = STRATEGIES.ROUND_ROBIN;

// 供应商使用计数
let providerUsage = {};

// 轮询计数器
let roundRobinCounter = 0;

/**
 * 负载均衡器类
 */
class LoadBalancer {
  constructor(providers = [], strategy = DEFAULT_STRATEGY) {
    this.providers = providers;
    this.strategy = strategy;
    this.init();
  }

  /**
   * 初始化负载均衡器
   */
  init() {
    // 重置使用计数
    this.providers.forEach(provider => {
      providerUsage[provider.id] = 0;
    });
    
    // 重置轮询计数器
    roundRobinCounter = 0;
  }

  /**
   * 添加供应商
   * @param {Object} provider 供应商配置
   */
  addProvider(provider) {
    if (!provider.id || !provider.baseUrl || !provider.token) {
      throw new Error('Provider must have id, baseUrl and token');
    }
    
    // 检查供应商ID是否已存在
    const existingProvider = this.providers.find(p => p.id === provider.id);
    if (existingProvider) {
      // 更新现有供应商
      Object.assign(existingProvider, provider);
    } else {
      // 添加新供应商
      this.providers.push(provider);
      providerUsage[provider.id] = 0;
    }
  }

  /**
   * 移除供应商
   * @param {string} providerId 供应商ID
   */
  removeProvider(providerId) {
    const index = this.providers.findIndex(p => p.id === providerId);
    if (index !== -1) {
      this.providers.splice(index, 1);
      delete providerUsage[providerId];
    }
  }

  /**
   * 获取下一个要使用的供应商
   * @returns {Object} 供应商配置
   */
  getNextProvider() {
    if (this.providers.length === 0) {
      return null;
    }
    
    if (this.providers.length === 1) {
      // 只有一个供应商，直接返回
      const provider = this.providers[0];
      providerUsage[provider.id]++;
      return provider;
    }
    
    let selectedProvider;
    
    switch (this.strategy) {
      case STRATEGIES.RANDOM:
        // 随机选择一个供应商
        selectedProvider = this.providers[Math.floor(Math.random() * this.providers.length)];
        break;
        
      case STRATEGIES.LEAST_USED:
        // 选择使用次数最少的供应商
        selectedProvider = this.providers.reduce((least, current) => {
          return (providerUsage[current.id] < providerUsage[least.id]) ? current : least;
        }, this.providers[0]);
        break;
        
      case STRATEGIES.ROUND_ROBIN:
      default:
        // 轮询选择
        selectedProvider = this.providers[roundRobinCounter % this.providers.length];
        roundRobinCounter++;
        break;
    }
    
    // 增加所选供应商的使用计数
    providerUsage[selectedProvider.id]++;
    
    return selectedProvider;
  }
  
  /**
   * 设置负载均衡策略
   * @param {string} strategy 策略名称
   */
  setStrategy(strategy) {
    if (Object.values(STRATEGIES).includes(strategy)) {
      this.strategy = strategy;
    } else {
      throw new Error(`Invalid strategy: ${strategy}`);
    }
  }
  
  /**
   * 重置使用计数
   */
  resetUsage() {
    this.providers.forEach(provider => {
      providerUsage[provider.id] = 0;
    });
    roundRobinCounter = 0;
  }
  
  /**
   * 获取所有供应商的使用情况
   * @returns {Object} 供应商使用情况
   */
  getUsageStats() {
    const stats = {};
    this.providers.forEach(provider => {
      stats[provider.id] = providerUsage[provider.id] || 0;
    });
    return stats;
  }
}

// 导出负载均衡器
export { LoadBalancer, STRATEGIES }; 