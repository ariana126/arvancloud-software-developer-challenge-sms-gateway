import { GetSenderTrafficHandler } from '@sms/application/queries/get-sender-traffic/get-sender-traffic.handler';
import { GetSentSmsReportHandler } from '@sms/application/queries/get-sent-sms-report/get-sent-sms-report.handler';
import { GetSmsPricingHandler } from '@sms/application/queries/get-sms-pricing/get-sms-pricing.handler';

export const QueryHandlers = [
  GetSenderTrafficHandler,
  GetSentSmsReportHandler,
  GetSmsPricingHandler,
];
