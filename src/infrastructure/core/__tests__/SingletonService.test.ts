import { describe, it, expect, beforeEach } from 'bun:test';
import { SingletonService, AsyncSingletonService } from '../SingletonService';

// Test implementations
class TestService extends SingletonService<TestService> {
  public value = 0;
  
  static getInstance(): TestService {
    return super.getInstance();
  }
  
  increment(): void {
    this.value++;
  }
}

class AnotherTestService extends SingletonService<AnotherTestService> {
  public name = 'another';
  
  static getInstance(): AnotherTestService {
    return super.getInstance();
  }
}

class AsyncTestService extends AsyncSingletonService<AsyncTestService> {
  public initialized = false;
  public value = 0;
  
  static async getInstance(): Promise<AsyncTestService> {
    return super.getInstanceAsync(async (instance) => {
      // Simulate async initialization
      await new Promise(resolve => setTimeout(resolve, 10));
      instance.initialized = true;
      instance.value = 42;
    });
  }
}

describe('SingletonService', () => {
  beforeEach(() => {
    SingletonService.clearAllInstances();
  });

  describe('Basic Singleton Functionality', () => {
    it('should return the same instance', () => {
      const instance1 = TestService.getInstance();
      const instance2 = TestService.getInstance();
      
      expect(instance1).toBe(instance2);
    });

    it('should maintain state across getInstance calls', () => {
      const instance1 = TestService.getInstance();
      instance1.increment();
      
      const instance2 = TestService.getInstance();
      expect(instance2.value).toBe(1);
    });

    it('should create different instances for different classes', () => {
      const testInstance = TestService.getInstance();
      const anotherInstance = AnotherTestService.getInstance();
      
      expect(testInstance).not.toBe(anotherInstance);
      expect(testInstance.constructor.name).toBe('TestService');
      expect(anotherInstance.constructor.name).toBe('AnotherTestService');
    });
  });

  describe('Instance Management', () => {
    it('should clear all instances', () => {
      const instance1 = TestService.getInstance();
      instance1.increment();
      
      SingletonService.clearAllInstances();
      
      const instance2 = TestService.getInstance();
      expect(instance2).not.toBe(instance1);
      expect(instance2.value).toBe(0);
    });

    it('should clear specific instance', () => {
      const testInstance1 = TestService.getInstance();
      testInstance1.increment();
      const anotherInstance = AnotherTestService.getInstance();
      
      SingletonService.clearInstance('TestService');
      
      const testInstance2 = TestService.getInstance();
      const anotherInstance2 = AnotherTestService.getInstance();
      
      expect(testInstance2).not.toBe(testInstance1);
      expect(testInstance2.value).toBe(0);
      expect(anotherInstance2).toBe(anotherInstance);
    });
  });

  describe('AsyncSingletonService', () => {
    beforeEach(() => {
      AsyncSingletonService.clearAllInstances();
    });

    it('should initialize asynchronously', async () => {
      const instance = await AsyncTestService.getInstance();
      
      expect(instance.initialized).toBe(true);
      expect(instance.value).toBe(42);
    });

    it('should return the same instance after initialization', async () => {
      const instance1 = await AsyncTestService.getInstance();
      const instance2 = await AsyncTestService.getInstance();
      
      expect(instance1).toBe(instance2);
    });

    it('should handle concurrent initialization requests', async () => {
      const promises = [
        AsyncTestService.getInstance(),
        AsyncTestService.getInstance(),
        AsyncTestService.getInstance()
      ];
      
      const instances = await Promise.all(promises);
      
      // All should be the same instance
      expect(instances[0]).toBe(instances[1]);
      expect(instances[1]).toBe(instances[2]);
      
      // Should be initialized only once
      expect(instances[0].initialized).toBe(true);
      expect(instances[0].value).toBe(42);
    });

    it('should track initialization state', async () => {
      expect(AsyncSingletonService.isInitialized('AsyncTestService')).toBe(false);
      
      await AsyncTestService.getInstance();
      
      expect(AsyncSingletonService.isInitialized('AsyncTestService')).toBe(true);
    });

    it('should clear initialization state with clearAllInstances', async () => {
      await AsyncTestService.getInstance();
      expect(AsyncSingletonService.isInitialized('AsyncTestService')).toBe(true);
      
      AsyncSingletonService.clearAllInstances();
      
      expect(AsyncSingletonService.isInitialized('AsyncTestService')).toBe(false);
    });
  });

  describe('Custom Key Support', () => {
    class MultiInstanceService extends SingletonService<MultiInstanceService> {
      constructor(public config: string = 'default') {
        super();
      }
      
      static getInstanceForConfig(config: string): MultiInstanceService {
        const instance = super.getInstanceWithKey(config);
        instance.config = config;
        return instance;
      }
    }

    it('should support multiple instances with different keys', () => {
      const instance1 = MultiInstanceService.getInstanceForConfig('config1');
      const instance2 = MultiInstanceService.getInstanceForConfig('config2');
      const instance1Again = MultiInstanceService.getInstanceForConfig('config1');
      
      expect(instance1).not.toBe(instance2);
      expect(instance1).toBe(instance1Again);
      expect(instance1.config).toBe('config1');
      expect(instance2.config).toBe('config2');
    });
  });
});