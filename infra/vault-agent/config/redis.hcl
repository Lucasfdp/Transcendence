exit_after_auth = false
pid_file = "/tmp/vault-agent.pid"

vault {
  address = "http://vault:8200"
  retry {
    num_retries = -1
  }
}

auto_auth {
  method "approle" {
    mount_path = "auth/approle"
    config = {
      role_id_file_path                 = "/vault/bootstrap/role_id"
      secret_id_file_path               = "/vault/bootstrap/secret_id"
      remove_secret_id_file_after_reading = false
    }
  }

  sink "file" {
    config = {
      path = "/vault/rendered/.vault-token"
      mode = 0600
    }
  }
}

template {
  source      = "/vault/templates/redis_password.ctmpl"
  destination = "/vault/rendered/redis_password"
  perms       = "0644"
}
