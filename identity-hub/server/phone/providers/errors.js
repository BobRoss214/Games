// One error type for all telephone adapters.
// The message is plain text for the user. It never has a phone number, a
// provider message, or a credential in it, so it is safe to show and to log.
export class ProviderError extends Error {
  constructor(message, { notFound = false, unavailable = false, tooLarge = false, status = 0, code = 0 } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.notFound = notFound; // the item does not exist at the provider (any more)
    this.unavailable = unavailable; // the number cannot be bought (taken or not offered)
    this.tooLarge = tooLarge; // a recording is larger than the caller permits
    this.status = status; // HTTP status from the provider, 0 if there was no answer
    this.code = code; // error code of the provider, 0 if none
  }
}
