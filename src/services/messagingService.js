/**
 * Future-Ready Messaging Integration Service
 * Prepares the foundation for SMS, WhatsApp, and Email notifications.
 */
export class MessagingService {
  constructor(config = {}) {
    this.adapters = {
      sms: config.smsAdapter || this.defaultSmsAdapter,
      whatsapp: config.whatsappAdapter || this.defaultWhatsappAdapter,
      email: config.emailAdapter || this.defaultEmailAdapter
    };
  }

  async send(channel, recipient, message) {
    const adapter = this.adapters[channel];
    if (!adapter) {
      throw new Error(`Unsupported messaging channel: ${channel}`);
    }
    console.log(`[MessagingService] Dispatching to ${channel} -> Recipient: ${recipient}`);
    return adapter(recipient, message);
  }

  // Hook/extension points for future developers to replace
  async defaultSmsAdapter(recipient, message) {
    console.log(`[SMS Stub] Sent to ${recipient}: "${message}"`);
    return { success: true, provider: 'MockSMS', messageId: `msg_${Date.now()}` };
  }

  async defaultWhatsappAdapter(recipient, message) {
    console.log(`[WhatsApp Stub] Sent to ${recipient}: "${message}"`);
    return { success: true, provider: 'MockWhatsApp', messageId: `wa_${Date.now()}` };
  }

  async defaultEmailAdapter(recipient, message) {
    console.log(`[Email Stub] Sent to ${recipient}: "${message}"`);
    return { success: true, provider: 'MockEmail', messageId: `mail_${Date.now()}` };
  }
}

export const messaging = new MessagingService();
