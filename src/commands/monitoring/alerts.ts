import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';

export default class MonitoringAlerts extends Command {
    static override description = 'Manage monitoring alerts and alert rules';

    static override examples = [
        '<%= config.bin %> <%= command.id %> --operation active',
        '<%= config.bin %> <%= command.id %> --operation create --service api --metric cpu --threshold 80',
    ];

    static override flags = {
        operation: Flags.string({
            description: 'Alert operation',
            options: ['active', 'history', 'create', 'edit', 'delete', 'silence', 'dashboard'],
            required: true,
        }),
        service: Flags.string({
            description: 'Service name for alert',
        }),
        metric: Flags.string({
            description: 'Metric to monitor',
            options: ['cpu', 'memory', 'disk', 'network', 'response_time', 'error_rate'],
        }),
        threshold: Flags.integer({
            description: 'Alert threshold value',
        }),
        duration: Flags.string({
            description: 'Duration threshold (e.g., "5m", "1h")',
            default: '5m',
        }),
        severity: Flags.string({
            description: 'Alert severity',
            options: ['low', 'medium', 'high', 'critical'],
            default: 'medium',
        }),
        output: Flags.string({
            description: 'Output format',
            options: ['text', 'json', 'csv'],
            default: 'text',
        }),
    };

    async run(): Promise<void> {
        const { flags } = await this.parse(MonitoringAlerts);

        try {
            await this.handleAlertOperation(flags);
        } catch (error) {
            this.error(`Failed to handle alert operation: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async handleAlertOperation(flags: any): Promise<void> {
        const { operation, service, metric, threshold, duration, severity, output } = flags;

        switch (operation) {
            case 'active':
                await this.showActiveAlerts(output);
                break;
            case 'history':
                await this.showAlertHistory(service, output);
                break;
            case 'create':
                await this.createAlertRule(service, metric, threshold, duration, severity);
                break;
            case 'edit':
                await this.editAlertRule(service, metric, threshold, duration, severity);
                break;
            case 'delete':
                await this.deleteAlertRule(service, metric);
                break;
            case 'silence':
                await this.silenceAlerts(service, duration);
                break;
            case 'dashboard':
                await this.showAlertDashboard();
                break;
            default:
                throw new Error(`Unknown operation: ${operation}`);
        }
    }

    private async showActiveAlerts(output?: string): Promise<void> {
        this.log(chalk.blue('🚨 Active Alerts'));
        this.log('='.repeat(50));

        try {
            const alerts = await this.getActiveAlerts();

            if (output === 'json') {
                this.log(JSON.stringify(alerts, null, 2));
            } else if (output === 'csv') {
                this.log(this.formatAlertsAsCsv(alerts));
            } else {
                this.log(this.formatAlertsAsText(alerts));
            }
        } catch (error) {
            this.log(chalk.red('Failed to retrieve active alerts'));
        }
    }

    private async showAlertHistory(service?: string, output?: string): Promise<void> {
        this.log(chalk.blue('📋 Alert History'));
        this.log('='.repeat(50));

        if (service) {
            this.log(chalk.yellow(`Filtering by service: ${service}`));
        }

        try {
            const alerts = await this.getAlertHistory(service);

            if (output === 'json') {
                this.log(JSON.stringify(alerts, null, 2));
            } else if (output === 'csv') {
                this.log(this.formatAlertsAsCsv(alerts));
            } else {
                this.log(this.formatAlertsAsText(alerts));
            }
        } catch (error) {
            this.log(chalk.red('Failed to retrieve alert history'));
        }
    }

    private async createAlertRule(service?: string, metric?: string, threshold?: number, duration?: string, severity?: string): Promise<void> {
        this.log(chalk.blue('➕ Creating Alert Rule'));
        this.log('='.repeat(50));

        if (!service || !metric || !threshold) {
            this.log(chalk.red('Service, metric, and threshold are required'));
            return;
        }

        try {
            const alertRule = {
                id: `alert-${Date.now()}`,
                service,
                metric,
                threshold,
                duration,
                severity,
                status: 'active',
                createdAt: new Date().toISOString(),
                description: `${metric} > ${threshold} for ${duration}`
            };

            await this.saveAlertRule(alertRule);
            this.log(chalk.green('✅ Alert rule created successfully'));
            this.log(chalk.cyan('Rule details:'));
            this.log(`  Service: ${service}`);
            this.log(`  Metric: ${metric}`);
            this.log(`  Threshold: ${threshold}`);
            this.log(`  Duration: ${duration}`);
            this.log(`  Severity: ${severity}`);
        } catch (error) {
            this.log(chalk.red('Failed to create alert rule'));
        }
    }

    private async editAlertRule(service?: string, metric?: string, threshold?: number, duration?: string, severity?: string): Promise<void> {
        this.log(chalk.blue('✏️ Editing Alert Rule'));
        this.log('='.repeat(50));

        if (!service || !metric) {
            this.log(chalk.red('Service and metric are required'));
            return;
        }

        try {
            const existingRule = await this.getAlertRule(service, metric);
            if (!existingRule) {
                this.log(chalk.red('Alert rule not found'));
                return;
            }

            const updatedRule = {
                ...existingRule,
                threshold: threshold || existingRule.threshold,
                duration: duration || existingRule.duration,
                severity: severity || existingRule.severity,
                updatedAt: new Date().toISOString()
            };

            await this.saveAlertRule(updatedRule);
            this.log(chalk.green('✅ Alert rule updated successfully'));
        } catch (error) {
            this.log(chalk.red('Failed to edit alert rule'));
        }
    }

    private async deleteAlertRule(service?: string, metric?: string): Promise<void> {
        this.log(chalk.blue('❌ Deleting Alert Rule'));
        this.log('='.repeat(50));

        if (!service || !metric) {
            this.log(chalk.red('Service and metric are required'));
            return;
        }

        try {
            const existingRule = await this.getAlertRule(service, metric);
            if (!existingRule) {
                this.log(chalk.red('Alert rule not found'));
                return;
            }

            await this.deleteAlertRuleById(existingRule.id);
            this.log(chalk.green('✅ Alert rule deleted successfully'));
        } catch (error) {
            this.log(chalk.red('Failed to delete alert rule'));
        }
    }

    private async silenceAlerts(service?: string, duration?: string): Promise<void> {
        this.log(chalk.blue('🔕 Silencing Alerts'));
        this.log('='.repeat(50));

        if (!service) {
            this.log(chalk.red('Service is required'));
            return;
        }

        try {
            const silenceRule = {
                id: `silence-${Date.now()}`,
                service,
                duration,
                status: 'active',
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + this.parseDuration(duration || '1h')).toISOString()
            };

            await this.saveSilenceRule(silenceRule);
            this.log(chalk.green('✅ Alerts silenced successfully'));
            this.log(chalk.cyan(`Service: ${service}`));
            this.log(chalk.cyan(`Duration: ${duration || '1h'}`));
        } catch (error) {
            this.log(chalk.red('Failed to silence alerts'));
        }
    }

    private async showAlertDashboard(): Promise<void> {
        this.log(chalk.blue('📊 Alert Dashboard'));
        this.log('='.repeat(50));

        try {
            const activeAlerts = await this.getActiveAlerts();
            const alertHistory = await this.getAlertHistory();
            const alertRules = await this.getAlertRules();

            this.log(chalk.cyan('📈 Summary:'));
            this.log(`  Active alerts: ${activeAlerts.length}`);
            this.log(`  Total alerts (24h): ${alertHistory.length}`);
            this.log(`  Alert rules: ${alertRules.length}`);

            this.log(chalk.cyan('\n🚨 Active Alerts by Severity:'));
            const bySeverity = this.groupBySeverity(activeAlerts);
            Object.entries(bySeverity).forEach(([severity, count]) => {
                const color = this.getSeverityColor(severity);
                this.log(`  ${color(severity.toUpperCase())}: ${count}`);
            });

            this.log(chalk.cyan('\n🔧 Alerts by Service:'));
            const byService = this.groupByService(activeAlerts);
            Object.entries(byService).forEach(([service, count]) => {
                this.log(`  ${service}: ${count}`);
            });

            this.log(chalk.cyan('\n📋 Recent Alerts:'));
            const recentAlerts = alertHistory.slice(0, 5);
            recentAlerts.forEach(alert => {
                const severityColor = this.getSeverityColor(alert.severity);
                const time = new Date(alert.timestamp).toLocaleString();
                this.log(`  ${time} [${severityColor(alert.severity.toUpperCase())}] ${alert.service}: ${alert.message}`);
            });
        } catch (error) {
            this.log(chalk.red('Failed to load alert dashboard'));
        }
    }

    private async getActiveAlerts(): Promise<any[]> {
        // TODO: Implement actual alert retrieval logic
        // This is a mock implementation
        return [
            {
                id: 'alert-1',
                service: 'api',
                metric: 'cpu',
                value: 85,
                threshold: 80,
                severity: 'high',
                message: 'CPU usage is above threshold',
                timestamp: new Date().toISOString(),
                status: 'active'
            },
            {
                id: 'alert-2',
                service: 'database',
                metric: 'memory',
                value: 92,
                threshold: 90,
                severity: 'critical',
                message: 'Memory usage is critical',
                timestamp: new Date(Date.now() - 300000).toISOString(),
                status: 'active'
            }
        ];
    }

    private async getAlertHistory(service?: string): Promise<any[]> {
        // TODO: Implement actual alert history retrieval
        const alerts = await this.getActiveAlerts();
        return alerts.filter(alert => !service || alert.service === service);
    }

    private async getAlertRules(): Promise<any[]> {
        // TODO: Implement actual alert rules retrieval
        return [
            {
                id: 'rule-1',
                service: 'api',
                metric: 'cpu',
                threshold: 80,
                duration: '5m',
                severity: 'high',
                status: 'active'
            }
        ];
    }

    private async getAlertRule(service: string, metric: string): Promise<any> {
        const rules = await this.getAlertRules();
        return rules.find(rule => rule.service === service && rule.metric === metric);
    }

    private async saveAlertRule(rule: any): Promise<void> {
        // TODO: Implement actual alert rule saving
        this.log(chalk.gray('Saving alert rule...'));
    }

    private async deleteAlertRuleById(id: string): Promise<void> {
        // TODO: Implement actual alert rule deletion
        this.log(chalk.gray('Deleting alert rule...'));
    }

    private async saveSilenceRule(rule: any): Promise<void> {
        // TODO: Implement actual silence rule saving
        this.log(chalk.gray('Saving silence rule...'));
    }

    private formatAlertsAsText(alerts: any[]): string {
        if (alerts.length === 0) {
            return 'No alerts found';
        }

        return alerts.map(alert => {
            const timestamp = new Date(alert.timestamp).toLocaleString();
            const severityColor = this.getSeverityColor(alert.severity);
            return `${timestamp} [${severityColor(alert.severity.toUpperCase())}] [${alert.service}] ${alert.message} (${alert.metric}: ${alert.value}/${alert.threshold})`;
        }).join('\n');
    }

    private formatAlertsAsCsv(alerts: any[]): string {
        const headers = ['timestamp', 'severity', 'service', 'metric', 'value', 'threshold', 'message'];
        const rows = alerts.map(alert => [
            alert.timestamp,
            alert.severity,
            alert.service,
            alert.metric,
            alert.value,
            alert.threshold,
            alert.message
        ]);

        return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    }

    private groupBySeverity(alerts: any[]): Record<string, number> {
        return alerts.reduce((acc, alert) => {
            acc[alert.severity] = (acc[alert.severity] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
    }

    private groupByService(alerts: any[]): Record<string, number> {
        return alerts.reduce((acc, alert) => {
            acc[alert.service] = (acc[alert.service] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
    }

    private getSeverityColor(severity: string): (text: string) => string {
        switch (severity) {
            case 'critical': return chalk.red;
            case 'high': return chalk.magenta;
            case 'medium': return chalk.yellow;
            case 'low': return chalk.blue;
            default: return chalk.white;
        }
    }

    private parseDuration(duration: string): number {
        const unit = duration.slice(-1);
        const value = parseInt(duration.slice(0, -1));

        switch (unit) {
            case 's': return value * 1000;
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            default: return 60 * 60 * 1000; // 1 hour default
        }
    }
} 