export interface AppConfig {
    nodeEnv: string;
    port: number;
    host: string;
    sessionSecret: string;
    cookieSecret: string;
    allowedOrigins: string[];
    rateLimitWindowMs: number;
    rateLimitMax: number;
}
export declare const appConfig: AppConfig;
//# sourceMappingURL=app.d.ts.map