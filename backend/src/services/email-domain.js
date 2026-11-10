function parseDomains(value, variableName) {
  const entries = String(value || '').split(',').map((domain) => domain.trim().toLowerCase()).filter(Boolean);
  for (const domain of entries) {
    if (!isValidDomain(domain)) {
      throw new Error(`${variableName} must contain exact domain names separated by commas`);
    }
  }
  return entries;
}

function isValidDomain(domain) {
  if (typeof domain !== 'string' || domain.length > 253 || !domain.includes('.')) {
    return false;
  }
  return domain.split('.').every((label) => (
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ));
}

function getAllowedEmailDomains(env = process.env) {
  const primary = parseDomains(env.ALLOWED_EMAIL_DOMAINS, 'ALLOWED_EMAIL_DOMAINS');
  if (!primary.length) {
    throw new Error('ALLOWED_EMAIL_DOMAINS must include at least one approved domain');
  }

  const developmentDomains = parseDomains(env.DEV_TEST_EMAIL_DOMAINS, 'DEV_TEST_EMAIL_DOMAINS');
  if (env.NODE_ENV === 'production' && developmentDomains.length) {
    throw new Error('DEV_TEST_EMAIL_DOMAINS must not be set in production');
  }

  return new Set(env.NODE_ENV === 'production'
    ? primary
    : [...primary, ...developmentDomains]);
}

function validateEmailAddress(address, env = process.env) {
  if (
    typeof address !== 'string' ||
    address.length > 254 ||
    address.length === 0 ||
    address !== address.trim() ||
    /\s/.test(address) ||
    (address.match(/@/g) || []).length !== 1
  ) {
    return { valid: false, reason: 'INVALID_ADDRESS' };
  }

  const separator = address.lastIndexOf('@');
  const localPart = address.slice(0, separator);
  const domain = address.slice(separator + 1).toLowerCase();
  if (
    !localPart ||
    localPart.length > 64 ||
    localPart.startsWith('.') ||
    localPart.endsWith('.') ||
    localPart.includes('..') ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart) ||
    !isValidDomain(domain)
  ) {
    return { valid: false, reason: 'INVALID_ADDRESS' };
  }

  let allowedDomains;
  try {
    allowedDomains = getAllowedEmailDomains(env);
  } catch (error) {
    return { valid: false, reason: 'EMAIL_POLICY_CONFIGURATION_INVALID', configurationError: error.message };
  }

  if (!allowedDomains.has(domain)) {
    return { valid: false, reason: 'EMAIL_DOMAIN_NOT_ALLOWED', email: address.toLowerCase(), domain };
  }

  return { valid: true, email: address.toLowerCase(), domain };
}

module.exports = { getAllowedEmailDomains, validateEmailAddress };
