export type ExternalAiErrorCode = 'auth' | 'validation' | 'not_found' | 'conflict';

export class ExternalAiError extends Error {
  constructor(
    public readonly code: ExternalAiErrorCode,
    message: string,
    public readonly candidates?: readonly unknown[],
  ) {
    super(message);
    this.name = 'ExternalAiError';
  }
}

