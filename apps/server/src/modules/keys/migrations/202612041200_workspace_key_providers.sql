-- Owned by modules/keys. #159: a workspace's own key may also live in Google Cloud KMS ('gcp-kms',
-- kms_key_id = projects/…/cryptoKeys/…), Azure Key Vault ('azure-key-vault', the key's URL) or a
-- HashiCorp Vault Transit engine ('vault-transit', <mount>/keys/<name>), besides AWS KMS. Every
-- provider but the instance's names its key.
ALTER TABLE workspace_keys DROP CONSTRAINT workspace_keys_provider_check;
ALTER TABLE workspace_keys ADD CONSTRAINT workspace_keys_provider_check
  CHECK (provider IN ('instance', 'aws-kms', 'gcp-kms', 'azure-key-vault', 'vault-transit'));
ALTER TABLE workspace_keys DROP CONSTRAINT workspace_keys_check;
ALTER TABLE workspace_keys ADD CONSTRAINT workspace_keys_kms_key_id_check
  CHECK ((provider = 'instance') = (kms_key_id IS NULL));
