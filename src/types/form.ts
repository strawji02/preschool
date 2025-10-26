export interface ContactFormData {
  kindergartenName: string;
  contact: string;
  privacyAgreed: boolean;
}

export interface ContactFormErrors {
  kindergartenName?: string;
  contact?: string;
  privacyAgreed?: string;
}

export interface FormSubmitResult {
  success: boolean;
  message: string;
}
