import https from 'https';
import fs from 'fs';
import { resolve } from 'pathe';
import { logger } from '@/logger.js';

export interface TLSConfig {
  enabled: boolean;
  port: number;
  cert?: string;
  key?: string;
  ca?: string;
  pfx?: string;
  passphrase?: string;
  secureProtocol: string;
  ciphers: string;
  honorCipherOrder: boolean;
  requestCert: boolean;
  rejectUnauthorized: boolean;
}

/**
 * TLS/HTTPS Configuration Manager
 * 
 * Handles secure transport layer configuration for production deployments
 * with modern TLS standards and security best practices.
 */
export class TLSConfigManager {
  private static instance: TLSConfigManager;
  private config: TLSConfig;

  private constructor() {
    this.config = this.loadTLSConfig();
  }

  static getInstance(): TLSConfigManager {
    if (!TLSConfigManager.instance) {
      TLSConfigManager.instance = new TLSConfigManager();
    }
    return TLSConfigManager.instance;
  }

  private loadTLSConfig(): TLSConfig {
    const isDev = process.env.NODE_ENV === 'development';

    return {
      enabled: !isDev && (!!process.env.TLS_CERT_PATH || !!process.env.TLS_PFX_PATH),
      port: parseInt(process.env.HTTPS_PORT || '8443'),
      cert: process.env.TLS_CERT_PATH,
      key: process.env.TLS_KEY_PATH,
      ca: process.env.TLS_CA_PATH,
      pfx: process.env.TLS_PFX_PATH,
      passphrase: process.env.TLS_PASSPHRASE,

      // Modern TLS configuration
      secureProtocol: 'TLSv1_3_method',
      ciphers: [
        // TLS 1.3 ciphers (preferred)
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256',
        'TLS_AES_128_GCM_SHA256',

        // TLS 1.2 fallback ciphers
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES256-SHA384',
        'ECDHE-RSA-AES128-SHA256',
        'ECDHE-RSA-AES256-SHA',
        'ECDHE-RSA-AES128-SHA',
      ].join(':'),

      honorCipherOrder: true,
      requestCert: false,
      rejectUnauthorized: true,
    };
  }

  /**
   * Get HTTPS server options
   */
  getHTTPSOptions(): https.ServerOptions {
    if (!this.config.enabled) {
      throw new Error('TLS is not enabled');
    }

    const options: https.ServerOptions = {
      secureProtocol: this.config.secureProtocol,
      ciphers: this.config.ciphers,
      honorCipherOrder: this.config.honorCipherOrder,
      requestCert: this.config.requestCert,
      rejectUnauthorized: this.config.rejectUnauthorized,
    };

    // Load certificate files
    if (this.config.pfx) {
      // PFX/PKCS12 format
      options.pfx = this.loadCertificateFile(this.config.pfx);
      if (this.config.passphrase) {
        options.passphrase = this.config.passphrase;
      }
    } else if (this.config.cert && this.config.key) {
      // Separate cert and key files
      options.cert = this.loadCertificateFile(this.config.cert);
      options.key = this.loadCertificateFile(this.config.key);

      if (this.config.ca) {
        options.ca = this.loadCertificateFile(this.config.ca);
      }
    } else {
      throw new Error('TLS certificate configuration is incomplete');
    }

    logger.info('TLS configuration loaded', {
      port: this.config.port,
      secureProtocol: this.config.secureProtocol,
      hasCert: !!options.cert || !!options.pfx,
      hasCA: !!options.ca,
    });

    return options;
  }

  private loadCertificateFile(filePath: string): Buffer {
    try {
      const resolvedPath = resolve(filePath);
      return fs.readFileSync(resolvedPath);
    } catch (error) {
      logger.error('Failed to load certificate file', { filePath, error });
      throw new Error(`Failed to load certificate file: ${filePath}`);
    }
  }

  /**
   * Create HTTPS server
   */
  createHTTPSServer(app: any): https.Server {
    if (!this.config.enabled) {
      throw new Error('TLS is not enabled');
    }

    const options = this.getHTTPSOptions();
    return https.createServer(options, app);
  }

  /**
   * Get TLS configuration for client connections
   */
  getClientTLSConfig(): {
    secureProtocol: string;
    ciphers: string;
    checkServerIdentity: (hostname: string, cert: any) => Error | undefined;
  } {
    return {
      secureProtocol: this.config.secureProtocol,
      ciphers: this.config.ciphers,
      checkServerIdentity: (hostname: string, cert: any) => {
        // Custom certificate validation logic
        if (!cert) {
          return new Error('No certificate provided');
        }

        // Additional validation can be added here
        return undefined;
      },
    };
  }

  /**
   * Generate self-signed certificate for development
   */
  static generateSelfSignedCert(): {
    cert: string;
    key: string;
  } {
    // This is a simplified example - in practice, use a proper certificate generation library
    try {
      const selfsigned = require('selfsigned');
      return this.generateWithSelfsigned(selfsigned);
    } catch (error) {
      // Fallback to mock certificates if selfsigned is not available
      logger.warn('selfsigned package not available, using mock certificates');
      return this.generateMockCertificate();
    }
  }

  private static generateWithSelfsigned(selfsigned: any): { cert: string; key: string } {
    const attrs = [
      { name: 'commonName', value: 'localhost' },
      { name: 'countryName', value: 'US' },
      { name: 'stateOrProvinceName', value: 'Development' },
      { name: 'localityName', value: 'Local' },
      { name: 'organizationName', value: 'Todo App Dev' },
      { name: 'organizationalUnitName', value: 'Development' },
    ];

    const options = {
      keySize: 2048,
      days: 365,
      algorithm: 'sha256',
      extensions: [
        {
          name: 'basicConstraints',
          cA: false,
        },
        {
          name: 'keyUsage',
          keyCertSign: false,
          digitalSignature: true,
          nonRepudiation: false,
          keyEncipherment: true,
          dataEncipherment: true,
        },
        {
          name: 'subjectAltName',
          altNames: [
            {
              type: 2, // DNS
              value: 'localhost',
            },
            {
              type: 7, // IP
              ip: '127.0.0.1',
            },
          ],
        },
      ],
    };

    const pems = selfsigned.generate(attrs, options);

    return {
      cert: pems.cert,
      key: pems.private,
    };
  }

  private static generateMockCertificate(): { cert: string; key: string } {
    // Mock certificate for development only - NOT for production use
    const mockCert = `-----BEGIN CERTIFICATE-----
MIIBkjCCATigAwIBAgIJAOJn9v3qHV3kMA0GCSqGSIb3DQEBCwUAMA8xDTALBgNV
BAoMBE1vY2swHhcNMjMwMTAxMDAwMDAwWhcNMjQwMTAxMDAwMDAwWjAPMQ0wCwYD
VQQKDARNb2NrMFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAMockFake1234567890
abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abc
defghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSCAwEAAaM8MDowDAYDVR0TAQH/
BAIwADAMBgNVHQ8EBQMDB6AAMC0GA1UdEQQmMCSDCWxvY2FsaG9zdIcEfwAAATC
BggqhkjOPQIBBQADSwAwSAJBAK1mock2MockCertificateForDevelopmentOnly123
MockMockMockMockMockMockMockMockMockMockMockMockMockMockMockMockMock
MockMockMockMockMockMockMockMockMockMockMockCAwEAAQ==
-----END CERTIFICATE-----`;

    const mockKey = `-----BEGIN PRIVATE KEY-----
MIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEAyMockFake1234567
890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789
abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSCAwEAAQJBAMockPrivate
Key1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ
0123456789abcdefghijklmnopqrstuvwxyzABCDEFGCEQJBAP123MockPrivateKey
TestingOnlyNotForProductionUseMockMockMockMockMockMockMockMockMockMock
MockMockMockMockMockMockMockMockMockMockMockMockMockMockCEQJBANMockTest
CertificateForDevelopmentPurposesOnlyNotSecureNotForProductionUseMockMock
MockMockMockMockMockMockMockMockMockMockMockMockCEQJAIMockDevelopment
KeyOnlyForTestingPurposesNotSecureNotForProductionUseMockMockMockMockMock
MockMockMockMockMockMockMockMockMockMockCEQJBAKMockDevelopmentCertificate
OnlyForTestingPurposesNotSecureNotForProductionUseMockMockMockMockMockMock
MockMockMockMockMockMockMockMockCEQJAFMockDevelopmentKeyOnlyForTesting
PurposesNotSecureNotForProductionUseMockMockMockMockMockMockMockMockMock
MockMockMockMockMockMockCE
-----END PRIVATE KEY-----`;

    logger.warn('Using mock TLS certificate - ONLY for development, NOT secure!');
    
    return {
      cert: mockCert,
      key: mockKey,
    };
  }

  /**
   * Validate TLS connection
   */
  validateConnection(req: any): {
    isSecure: boolean;
    protocol?: string;
    cipher?: string;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check if connection is secure
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';

    if (!isSecure) {
      issues.push('Connection is not using HTTPS');
    }

    // Check TLS version
    const tlsVersion = req.connection?.getProtocol?.();
    if (tlsVersion) {
      if (!['TLSv1.2', 'TLSv1.3'].includes(tlsVersion)) {
        issues.push(`Insecure TLS version: ${tlsVersion}`);
      }
    }

    // Check cipher suite
    const cipher = req.connection?.getCipher?.();
    if (cipher) {
      // Check for weak ciphers
      const weakCiphers = ['RC4', 'DES', '3DES', 'MD5'];
      const cipherName = cipher.name || '';

      for (const weak of weakCiphers) {
        if (cipherName.includes(weak)) {
          issues.push(`Weak cipher detected: ${cipherName}`);
          break;
        }
      }
    }

    return {
      isSecure,
      protocol: tlsVersion,
      cipher: cipher?.name,
      issues,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): TLSConfig {
    return { ...this.config };
  }

  /**
   * Check if TLS is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get HTTPS port
   */
  getPort(): number {
    return this.config.port;
  }
}

/**
 * Middleware to enforce HTTPS
 */
export function createHTTPSRedirectMiddleware() {
  return (req: any, res: any, next: any) => {
    const tlsConfig = TLSConfigManager.getInstance();

    if (!tlsConfig.isEnabled()) {
      return next();
    }

    const validation = tlsConfig.validateConnection(req);

    if (!validation.isSecure) {
      const httpsUrl = `https://${req.get('host')}:${tlsConfig.getPort()}${req.originalUrl}`;
      return res.redirect(301, httpsUrl);
    }

    // Log any TLS issues
    if (validation.issues.length > 0) {
      logger.warn('TLS connection issues detected', {
        issues: validation.issues,
        userAgent: req.get('user-agent'),
        ip: req.ip,
      });
    }

    next();
  };
}

/**
 * Security headers middleware for HTTPS
 */
export function createHTTPSSecurityHeaders() {
  const tlsConfig = TLSConfigManager.getInstance();

  return (req: any, res: any, next: any) => {
    if (tlsConfig.isEnabled()) {
      // Strict Transport Security
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

      // Upgrade insecure requests
      res.setHeader('Content-Security-Policy', "upgrade-insecure-requests");

      // Certificate transparency
      res.setHeader('Expect-CT', 'max-age=86400, enforce');
    }

    next();
  };
}

export const tlsConfigManager = TLSConfigManager.getInstance();