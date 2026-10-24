declare global {
  namespace App {
    interface Locals {
      userId?: string;
      accessToken?: string;
      sessionId?: string;
    }
  }
}
export {};
