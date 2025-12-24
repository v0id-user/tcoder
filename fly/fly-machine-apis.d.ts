import type {
  OpenAPIClient,
  Parameters,
  UnknownParamsObject,
  OperationResponse,
  AxiosRequestConfig,
} from 'openapi-client-axios';

declare namespace Components {
    namespace Schemas {
        export interface App {
            id?: string;
            internal_numeric_id?: number;
            machine_count?: number;
            name?: string;
            network?: string;
            organization?: AppOrganizationInfo;
            status?: string;
            volume_count?: number;
        }
        export interface AppOrganizationInfo {
            internal_numeric_id?: number;
            name?: string;
            slug?: string;
        }
        export interface AppSecret {
            created_at?: string;
            digest?: string;
            name?: string;
            updated_at?: string;
            value?: string;
        }
        export interface AppSecrets {
            secrets?: AppSecret[];
        }
        export interface AppSecretsUpdateRequest {
            values?: {
                [name: string]: string;
            };
        }
        export interface AppSecretsUpdateResp {
            /**
             * DEPRECATED
             */
            Version?: number;
            secrets?: AppSecret[];
            version?: number;
        }
        export interface AssignIPRequest {
            network?: string;
            org_slug?: string;
            region?: string;
            service_name?: string;
            type?: string;
        }
        export interface CheckStatus {
            name?: string;
            output?: string;
            status?: string;
            updated_at?: string;
        }
        export interface CreateAppDeployTokenRequest {
            expiry?: string;
        }
        export interface CreateAppRequest {
            enable_subdomains?: boolean;
            name?: string;
            network?: string;
            org_slug?: string;
        }
        export interface CreateAppResponse {
            token?: string;
        }
        export interface CreateLeaseRequest {
            description?: string;
            /**
             * seconds lease will be valid
             */
            ttl?: number;
        }
        export interface CreateMachineRequest {
            /**
             * An object defining the Machine configuration
             */
            config?: {
                /**
                 * Optional boolean telling the Machine to destroy itself once it’s complete (default false)
                 */
                auto_destroy?: boolean;
                /**
                 * An optional object that defines one or more named top-level checks. The key for each check is the check name.
                 */
                checks?: {
                    [name: string]: FlyMachineCheck;
                };
                /**
                 * Containers are a list of containers that will run in the machine. Currently restricted to
                 * only specific organizations.
                 */
                containers?: FlyContainerConfig[];
                /**
                 * Deprecated: use Service.Autostart instead
                 */
                disable_machine_autostart?: boolean;
                dns?: FlyDNSConfig;
                /**
                 * An object filled with key/value pairs to be set as environment variables
                 */
                env?: {
                    [name: string]: string;
                };
                files?: /* A file that will be written to the Machine. One of RawValue or SecretName must be set. */ FlyFile[];
                guest?: FlyMachineGuest;
                /**
                 * The docker image to run
                 */
                image?: string;
                init?: FlyMachineInit;
                metadata?: {
                    [name: string]: string;
                };
                metrics?: FlyMachineMetrics;
                mounts?: FlyMachineMount[];
                processes?: FlyMachineProcess[];
                restart?: /* The Machine restart policy defines whether and how flyd restarts a Machine after its main process exits. See https://fly.io/docs/machines/guides-examples/machine-restart-policy/. */ FlyMachineRestart;
                schedule?: string;
                services?: FlyMachineService[];
                /**
                 * Deprecated: use Guest instead
                 */
                size?: string;
                /**
                 * Standbys enable a machine to be a standby for another. In the event of a hardware failure,
                 * the standby machine will be started.
                 */
                standbys?: string[];
                statics?: FlyStatic[];
                stop_config?: FlyStopConfig;
            };
            lease_ttl?: number;
            lsvd?: boolean;
            min_secrets_version?: number;
            /**
             * Unique name for this Machine. If omitted, one is generated for you
             */
            name?: string;
            /**
             * The target region. Omitting this param launches in the same region as your WireGuard peer connection (somewhere near you).
             */
            region?: string;
            skip_launch?: boolean;
            skip_secrets?: boolean;
            skip_service_registration?: boolean;
        }
        /**
         * Optional parameters
         */
        export interface CreateOIDCTokenRequest {
            /**
             * example:
             * https://fly.io/org-slug
             */
            aud?: string;
            aws_principal_tags?: boolean;
        }
        export interface CreateVolumeRequest {
            /**
             * enable scheduled automatic snapshots. Defaults to `true`
             */
            auto_backup_enabled?: boolean;
            compute?: FlyMachineGuest;
            compute_image?: string;
            encrypted?: boolean;
            fstype?: string;
            name?: string;
            region?: string;
            require_unique_zone?: boolean;
            size_gb?: number;
            /**
             * restore from snapshot
             */
            snapshot_id?: string;
            snapshot_retention?: number;
            /**
             * fork from remote volume
             */
            source_volume_id?: string;
            unique_zone_app_wide?: boolean;
        }
        export interface CurrentTokenResponse {
            tokens?: MainTokenInfo[];
        }
        export interface DecryptSecretkeyRequest {
            associated_data?: number[];
            ciphertext?: number[];
        }
        export interface DecryptSecretkeyResponse {
            plaintext?: number[];
        }
        export interface DeleteAppSecretResponse {
            /**
             * DEPRECATED
             */
            Version?: number;
            version?: number;
        }
        export interface DeleteSecretkeyResponse {
            /**
             * DEPRECATED
             */
            Version?: number;
            version?: number;
        }
        export interface EncryptSecretkeyRequest {
            associated_data?: number[];
            plaintext?: number[];
        }
        export interface EncryptSecretkeyResponse {
            ciphertext?: number[];
        }
        export interface ErrorResponse {
            /**
             * Deprecated
             */
            details?: {
                [key: string]: any;
            };
            error?: string;
            status?: MainStatusCode;
        }
        export interface ExtendVolumeRequest {
            size_gb?: number;
        }
        export interface ExtendVolumeResponse {
            needs_restart?: boolean;
            volume?: Volume;
        }
        export interface FlyContainerConfig {
            /**
             * CmdOverride is used to override the default command of the image.
             */
            cmd?: string[];
            /**
             * DependsOn can be used to define dependencies between containers. The container will only be
             * started after all of its dependent conditions have been satisfied.
             */
            depends_on?: FlyContainerDependency[];
            /**
             * EntrypointOverride is used to override the default entrypoint of the image.
             */
            entrypoint?: string[];
            /**
             * ExtraEnv is used to add additional environment variables to the container.
             */
            env?: {
                [name: string]: string;
            };
            /**
             * EnvFrom can be provided to set environment variables from machine fields.
             */
            env_from?: /* EnvVar defines an environment variable to be populated from a machine field, env_var */ FlyEnvFrom[];
            /**
             * Image Config overrides - these fields are used to override the image configuration.
             * If not provided, the image configuration will be used.
             * ExecOverride is used to override the default command of the image.
             */
            exec?: string[];
            /**
             * Files are files that will be written to the container file system.
             */
            files?: /* A file that will be written to the Machine. One of RawValue or SecretName must be set. */ FlyFile[];
            /**
             * Healthchecks determine the health of your containers. Healthchecks can use HTTP, TCP or an Exec command.
             */
            healthchecks?: FlyContainerHealthcheck[];
            /**
             * Image is the docker image to run.
             */
            image?: string;
            /**
             * Name is used to identify the container in the machine.
             */
            name?: string;
            /**
             * Restart is used to define the restart policy for the container. NOTE: spot-price is not
             * supported for containers.
             */
            restart?: {
                /**
                 * GPU bid price for spot Machines.
                 */
                gpu_bid_price?: number;
                /**
                 * When policy is on-failure, the maximum number of times to attempt to restart the Machine before letting it stop.
                 */
                max_retries?: number;
                /**
                 * * no - Never try to restart a Machine automatically when its main process exits, whether that’s on purpose or on a crash.
                 * * always - Always restart a Machine automatically and never let it enter a stopped state, even when the main process exits cleanly.
                 * * on-failure - Try up to MaxRetries times to automatically restart the Machine if it exits with a non-zero exit code. Default when no explicit policy is set, and for Machines with schedules.
                 * * spot-price - Starts the Machine only when there is capacity and the spot price is less than or equal to the bid price.
                 */
                policy?: "no" | "always" | "on-failure" | "spot-price";
            };
            /**
             * Secrets can be provided at the process level to explicitly indicate which secrets should be
             * used for the process. If not provided, the secrets provided at the machine level will be used.
             */
            secrets?: /* A Secret needing to be set in the environment of the Machine. env_var is required */ FlyMachineSecret[];
            /**
             * Stop is used to define the signal and timeout for stopping the container.
             */
            stop?: {
                signal?: string;
                timeout?: FlyDuration;
            };
            /**
             * UserOverride is used to override the default user of the image.
             */
            user?: string;
        }
        export interface FlyContainerDependency {
            condition?: "exited_successfully" | "healthy" | "started";
            name?: string;
        }
        export type FlyContainerDependencyCondition = "exited_successfully" | "healthy" | "started";
        export interface FlyContainerHealthcheck {
            exec?: FlyExecHealthcheck;
            /**
             * The number of times the check must fail before considering the container unhealthy.
             */
            failure_threshold?: number;
            /**
             * The time in seconds to wait after a container starts before checking its health.
             */
            grace_period?: number;
            http?: FlyHTTPHealthcheck;
            /**
             * The time in seconds between executing the defined check.
             */
            interval?: number;
            /**
             * Kind of healthcheck (readiness, liveness)
             */
            kind?: "readiness" | "liveness";
            /**
             * The name of the check. Must be unique within the container.
             */
            name?: string;
            /**
             * The number of times the check must succeeed before considering the container healthy.
             */
            success_threshold?: number;
            tcp?: FlyTCPHealthcheck;
            /**
             * The time in seconds to wait for the check to complete.
             */
            timeout?: number;
            /**
             * Unhealthy policy that determines what action to take if a container is deemed unhealthy
             */
            unhealthy?: "stop";
        }
        export type FlyContainerHealthcheckKind = "readiness" | "liveness";
        export type FlyContainerHealthcheckScheme = "http" | "https";
        export interface FlyDNSConfig {
            dns_forward_rules?: FlyDnsForwardRule[];
            hostname?: string;
            hostname_fqdn?: string;
            nameservers?: string[];
            options?: FlyDnsOption[];
            searches?: string[];
            skip_registration?: boolean;
        }
        export interface FlyDnsForwardRule {
            addr?: string;
            basename?: string;
        }
        export interface FlyDnsOption {
            name?: string;
            value?: string;
        }
        export interface FlyDuration {
            "time.Duration"?: number;
        }
        /**
         * EnvVar defines an environment variable to be populated from a machine field, env_var
         */
        export interface FlyEnvFrom {
            /**
             * EnvVar is required and is the name of the environment variable that will be set from the
             * secret. It must be a valid environment variable name.
             */
            env_var?: string;
            /**
             * FieldRef selects a field of the Machine: supports id, version, app_name, private_ip, region, image.
             */
            field_ref?: "id" | "version" | "app_name" | "private_ip" | "region" | "image";
        }
        export interface FlyExecHealthcheck {
            /**
             * The command to run to check the health of the container (e.g. ["cat", "/tmp/healthy"])
             */
            command?: string[];
        }
        /**
         * A file that will be written to the Machine. One of RawValue or SecretName must be set.
         */
        export interface FlyFile {
            /**
             * GuestPath is the path on the machine where the file will be written and must be an absolute path.
             * For example: /full/path/to/file.json
             */
            guest_path?: string;
            /**
             * The name of an image to use the OCI image config as the file contents.
             */
            image_config?: string;
            /**
             * Mode bits used to set permissions on this file as accepted by chmod(2).
             */
            mode?: number;
            /**
             * The base64 encoded string of the file contents.
             */
            raw_value?: string;
            /**
             * The name of the secret that contains the base64 encoded file contents.
             */
            secret_name?: string;
        }
        export interface FlyHTTPHealthcheck {
            /**
             * Additional headers to send with the request
             */
            headers?: /* For http checks, an array of objects with string field Name and array of strings field Values. The key/value pairs specify header and header values that will get passed with the check call. */ FlyMachineHTTPHeader[];
            /**
             * The HTTP method to use to when making the request
             */
            method?: string;
            /**
             * The path to send the request to
             */
            path?: string;
            /**
             * The port to connect to, often the same as internal_port
             */
            port?: number;
            /**
             * Whether to use http or https
             */
            scheme?: "http" | "https";
            /**
             * If the protocol is https, the hostname to use for TLS certificate validation
             */
            tls_server_name?: string;
            /**
             * If the protocol is https, whether or not to verify the TLS certificate
             */
            tls_skip_verify?: boolean;
        }
        export interface FlyHTTPOptions {
            compress?: boolean;
            h2_backend?: boolean;
            headers_read_timeout?: number;
            idle_timeout?: number;
            replay_cache?: FlyReplayCache[];
            response?: FlyHTTPResponseOptions;
        }
        export interface FlyHTTPResponseOptions {
            headers?: {
                [name: string]: {
                    [key: string]: any;
                };
            };
            pristine?: boolean;
        }
        export interface FlyMachineCheck {
            /**
             * The time to wait after a VM starts before checking its health
             */
            grace_period?: {
                "time.Duration"?: number;
            };
            headers?: /* For http checks, an array of objects with string field Name and array of strings field Values. The key/value pairs specify header and header values that will get passed with the check call. */ FlyMachineHTTPHeader[];
            /**
             * The time between connectivity checks
             */
            interval?: {
                "time.Duration"?: number;
            };
            /**
             * Kind of the check (informational, readiness)
             */
            kind?: "informational" | "readiness";
            /**
             * For http checks, the HTTP method to use to when making the request
             */
            method?: string;
            /**
             * For http checks, the path to send the request to
             */
            path?: string;
            /**
             * The port to connect to, often the same as internal_port
             */
            port?: number;
            /**
             * For http checks, whether to use http or https
             */
            protocol?: string;
            /**
             * The maximum time a connection can take before being reported as failing its health check
             */
            timeout?: {
                "time.Duration"?: number;
            };
            /**
             * If the protocol is https, the hostname to use for TLS certificate validation
             */
            tls_server_name?: string;
            /**
             * For http checks with https protocol, whether or not to verify the TLS certificate
             */
            tls_skip_verify?: boolean;
            /**
             * tcp or http
             */
            type?: string;
        }
        export interface FlyMachineConfig {
            /**
             * Optional boolean telling the Machine to destroy itself once it’s complete (default false)
             */
            auto_destroy?: boolean;
            /**
             * An optional object that defines one or more named top-level checks. The key for each check is the check name.
             */
            checks?: {
                [name: string]: FlyMachineCheck;
            };
            /**
             * Containers are a list of containers that will run in the machine. Currently restricted to
             * only specific organizations.
             */
            containers?: FlyContainerConfig[];
            /**
             * Deprecated: use Service.Autostart instead
             */
            disable_machine_autostart?: boolean;
            dns?: FlyDNSConfig;
            /**
             * An object filled with key/value pairs to be set as environment variables
             */
            env?: {
                [name: string]: string;
            };
            files?: /* A file that will be written to the Machine. One of RawValue or SecretName must be set. */ FlyFile[];
            guest?: FlyMachineGuest;
            /**
             * The docker image to run
             */
            image?: string;
            init?: FlyMachineInit;
            metadata?: {
                [name: string]: string;
            };
            metrics?: FlyMachineMetrics;
            mounts?: FlyMachineMount[];
            processes?: FlyMachineProcess[];
            restart?: /* The Machine restart policy defines whether and how flyd restarts a Machine after its main process exits. See https://fly.io/docs/machines/guides-examples/machine-restart-policy/. */ FlyMachineRestart;
            schedule?: string;
            services?: FlyMachineService[];
            /**
             * Deprecated: use Guest instead
             */
            size?: string;
            /**
             * Standbys enable a machine to be a standby for another. In the event of a hardware failure,
             * the standby machine will be started.
             */
            standbys?: string[];
            statics?: FlyStatic[];
            stop_config?: FlyStopConfig;
        }
        export interface FlyMachineGuest {
            cpu_kind?: string;
            cpus?: number;
            gpu_kind?: string;
            gpus?: number;
            host_dedication_id?: string;
            kernel_args?: string[];
            memory_mb?: number;
            persist_rootfs?: "never" | "always" | "restart";
        }
        /**
         * For http checks, an array of objects with string field Name and array of strings field Values. The key/value pairs specify header and header values that will get passed with the check call.
         */
        export interface FlyMachineHTTPHeader {
            /**
             * The header name
             */
            name?: string;
            /**
             * The header value
             */
            values?: string[];
        }
        export interface FlyMachineInit {
            cmd?: string[];
            entrypoint?: string[];
            exec?: string[];
            kernel_args?: string[];
            swap_size_mb?: number;
            tty?: boolean;
        }
        export interface FlyMachineMetrics {
            https?: boolean;
            path?: string;
            port?: number;
        }
        export interface FlyMachineMount {
            add_size_gb?: number;
            encrypted?: boolean;
            extend_threshold_percent?: number;
            name?: string;
            path?: string;
            size_gb?: number;
            size_gb_limit?: number;
            volume?: string;
        }
        export interface FlyMachinePort {
            end_port?: number;
            force_https?: boolean;
            handlers?: string[];
            http_options?: FlyHTTPOptions;
            port?: number;
            proxy_proto_options?: FlyProxyProtoOptions;
            start_port?: number;
            tls_options?: FlyTLSOptions;
        }
        export interface FlyMachineProcess {
            cmd?: string[];
            entrypoint?: string[];
            env?: {
                [name: string]: string;
            };
            /**
             * EnvFrom can be provided to set environment variables from machine fields.
             */
            env_from?: /* EnvVar defines an environment variable to be populated from a machine field, env_var */ FlyEnvFrom[];
            exec?: string[];
            /**
             * IgnoreAppSecrets can be set to true to ignore the secrets for the App the Machine belongs to
             * and only use the secrets provided at the process level. The default/legacy behavior is to use
             * the secrets provided at the App level.
             */
            ignore_app_secrets?: boolean;
            /**
             * Secrets can be provided at the process level to explicitly indicate which secrets should be
             * used for the process. If not provided, the secrets provided at the machine level will be used.
             */
            secrets?: /* A Secret needing to be set in the environment of the Machine. env_var is required */ FlyMachineSecret[];
            user?: string;
        }
        /**
         * The Machine restart policy defines whether and how flyd restarts a Machine after its main process exits. See https://fly.io/docs/machines/guides-examples/machine-restart-policy/.
         */
        export interface FlyMachineRestart {
            /**
             * GPU bid price for spot Machines.
             */
            gpu_bid_price?: number;
            /**
             * When policy is on-failure, the maximum number of times to attempt to restart the Machine before letting it stop.
             */
            max_retries?: number;
            /**
             * * no - Never try to restart a Machine automatically when its main process exits, whether that’s on purpose or on a crash.
             * * always - Always restart a Machine automatically and never let it enter a stopped state, even when the main process exits cleanly.
             * * on-failure - Try up to MaxRetries times to automatically restart the Machine if it exits with a non-zero exit code. Default when no explicit policy is set, and for Machines with schedules.
             * * spot-price - Starts the Machine only when there is capacity and the spot price is less than or equal to the bid price.
             */
            policy?: "no" | "always" | "on-failure" | "spot-price";
        }
        /**
         * A Secret needing to be set in the environment of the Machine. env_var is required
         */
        export interface FlyMachineSecret {
            /**
             * EnvVar is required and is the name of the environment variable that will be set from the
             * secret. It must be a valid environment variable name.
             */
            env_var?: string;
            /**
             * Name is optional and when provided is used to reference a secret name where the EnvVar is
             * different from what was set as the secret name.
             */
            name?: string;
        }
        export interface FlyMachineService {
            autostart?: boolean;
            /**
             * Accepts a string (new format) or a boolean (old format). For backward compatibility with older clients, the API continues to use booleans for "off" and "stop" in responses.
             * * "off" or false - Do not autostop the Machine.
             * * "stop" or true - Automatically stop the Machine.
             * * "suspend" - Automatically suspend the Machine, falling back to a full stop if this is not possible.
             */
            autostop?: "off" | "stop" | "suspend";
            /**
             * An optional list of service checks
             */
            checks?: FlyMachineServiceCheck[];
            concurrency?: FlyMachineServiceConcurrency;
            force_instance_description?: string;
            force_instance_key?: string;
            internal_port?: number;
            min_machines_running?: number;
            ports?: FlyMachinePort[];
            protocol?: string;
        }
        export interface FlyMachineServiceCheck {
            /**
             * The time to wait after a VM starts before checking its health
             */
            grace_period?: {
                "time.Duration"?: number;
            };
            headers?: /* For http checks, an array of objects with string field Name and array of strings field Values. The key/value pairs specify header and header values that will get passed with the check call. */ FlyMachineHTTPHeader[];
            /**
             * The time between connectivity checks
             */
            interval?: {
                "time.Duration"?: number;
            };
            /**
             * For http checks, the HTTP method to use to when making the request
             */
            method?: string;
            /**
             * For http checks, the path to send the request to
             */
            path?: string;
            /**
             * The port to connect to, often the same as internal_port
             */
            port?: number;
            /**
             * For http checks, whether to use http or https
             */
            protocol?: string;
            /**
             * The maximum time a connection can take before being reported as failing its health check
             */
            timeout?: {
                "time.Duration"?: number;
            };
            /**
             * If the protocol is https, the hostname to use for TLS certificate validation
             */
            tls_server_name?: string;
            /**
             * For http checks with https protocol, whether or not to verify the TLS certificate
             */
            tls_skip_verify?: boolean;
            /**
             * tcp or http
             */
            type?: string;
        }
        export interface FlyMachineServiceConcurrency {
            hard_limit?: number;
            soft_limit?: number;
            type?: string;
        }
        export interface FlyProxyProtoOptions {
            version?: string;
        }
        export interface FlyReplayCache {
            allow_bypass?: boolean;
            /**
             * Name of the cookie or header to key the cache on
             */
            name?: string;
            path_prefix?: string;
            ttl_seconds?: number;
            /**
             * Currently either "cookie" or "header"
             */
            type?: "cookie" | "header";
        }
        export interface FlyStatic {
            guest_path: string;
            index_document?: string;
            tigris_bucket?: string;
            url_prefix: string;
        }
        export interface FlyStopConfig {
            signal?: string;
            timeout?: FlyDuration;
        }
        export interface FlyTCPHealthcheck {
            /**
             * The port to connect to, often the same as internal_port
             */
            port?: number;
        }
        export interface FlyTLSOptions {
            alpn?: string[];
            default_self_signed?: boolean;
            versions?: string[];
        }
        export type FlyUnhealthyPolicy = "stop";
        export interface Flydv1ExecResponse {
            exit_code?: number;
            exit_signal?: number;
            stderr?: string;
            stdout?: string;
        }
        export interface IPAssignment {
            created_at?: string;
            ip?: string;
            region?: string;
            service_name?: string;
            shared?: boolean;
        }
        export interface ImageRef {
            digest?: string;
            labels?: {
                [name: string]: string;
            };
            registry?: string;
            repository?: string;
            tag?: string;
        }
        export interface Lease {
            /**
             * Description or reason for the Lease.
             */
            description?: string;
            /**
             * ExpiresAt is the unix timestamp in UTC to denote when the Lease will no longer be valid.
             */
            expires_at?: number;
            /**
             * Nonce is the unique ID autogenerated and associated with the Lease.
             */
            nonce?: string;
            /**
             * Owner is the user identifier which acquired the Lease.
             */
            owner?: string;
            /**
             * Machine version
             */
            version?: string;
        }
        export interface ListAppsResponse {
            apps?: App[];
            total_apps?: number;
        }
        export interface ListIPAssignmentsResponse {
            ips?: IPAssignment[];
        }
        export interface ListenSocket {
            address?: string;
            proto?: string;
        }
        export interface Machine {
            checks?: CheckStatus[];
            config?: FlyMachineConfig;
            created_at?: string;
            events?: MachineEvent[];
            host_status?: "ok" | "unknown" | "unreachable";
            id?: string;
            image_ref?: ImageRef;
            incomplete_config?: FlyMachineConfig;
            /**
             * InstanceID is unique for each version of the machine
             */
            instance_id?: string;
            name?: string;
            /**
             * Nonce is only every returned on machine creation if a lease_duration was provided.
             */
            nonce?: string;
            /**
             * PrivateIP is the internal 6PN address of the machine.
             */
            private_ip?: string;
            region?: string;
            state?: string;
            updated_at?: string;
        }
        export interface MachineEvent {
            id?: string;
            request?: {
                [key: string]: any;
            };
            source?: string;
            status?: string;
            timestamp?: number;
            type?: string;
        }
        export interface MachineExecRequest {
            /**
             * Deprecated: use Command instead
             */
            cmd?: string;
            command?: string[];
            container?: string;
            stdin?: string;
            timeout?: number;
        }
        export interface MachineVersion {
            user_config?: FlyMachineConfig;
            version?: string;
        }
        export interface MainGetPlacementsRequest {
            /**
             * Resource requirements for the Machine to simulate. Defaults to a performance-1x machine
             */
            compute?: {
                cpu_kind?: string;
                cpus?: number;
                gpu_kind?: string;
                gpus?: number;
                host_dedication_id?: string;
                kernel_args?: string[];
                memory_mb?: number;
                persist_rootfs?: "never" | "always" | "restart";
            };
            /**
             * Number of machines to simulate placement.
             * Defaults to 0, which returns the org-specific limit for each region.
             */
            count?: number;
            /**
             * example:
             * personal
             */
            org_slug: string;
            /**
             * Region expression for placement as a comma-delimited set of regions or aliases.
             * Defaults to "[region],any", to prefer the API endpoint's local region with any other region as fallback.
             * example:
             * lhr,eu
             */
            region?: string;
            /**
             * example:
             *
             */
            volume_name?: string;
            volume_size_bytes?: number;
            /**
             * Optional weights to override default placement preferences.
             * example:
             * {
             *   "region": 1000,
             *   "spread": 0
             * }
             */
            weights?: {
                [name: string]: number;
            };
        }
        export interface MainGetPlacementsResponse {
            regions?: PlacementRegionPlacement[];
        }
        export interface MainReclaimMemoryRequest {
            amount_mb?: number;
        }
        export interface MainReclaimMemoryResponse {
            actual_mb?: number;
        }
        export interface MainRegionResponse {
            nearest?: string;
            regions?: ReadsGetCapacityPerRegionRow[];
        }
        export type MainStatusCode = "unknown" | "insufficient_capacity";
        export interface MainTokenInfo {
            apps?: string[];
            org_slug?: string;
            organization?: string;
            /**
             * Machine the token is restricted to (FromMachine caveat)
             */
            restricted_to_machine?: string;
            /**
             * Machine making the request
             */
            source_machine_id?: string;
            token_id?: string;
            /**
             * User identifier if token is for a user
             */
            user?: string;
        }
        export interface PlacementRegionPlacement {
            concurrency?: number;
            count?: number;
            region?: string;
        }
        export interface PlacementWeights {
            [name: string]: number;
        }
        export interface ProcessStat {
            command?: string;
            cpu?: number;
            directory?: string;
            listen_sockets?: ListenSocket[];
            pid?: number;
            rss?: number;
            rtime?: number;
            stime?: number;
        }
        export interface ReadsGetCapacityPerRegionRow {
            capacity?: number;
            code?: string;
            deprecated?: boolean;
            gateway_available?: boolean;
            geo_region?: string;
            latitude?: number;
            longitude?: number;
            name?: string;
            requires_paid_plan?: boolean;
        }
        export interface SecretKey {
            created_at?: string;
            name?: string;
            public_key?: number[];
            type?: string;
            updated_at?: string;
        }
        export interface SecretKeys {
            secret_keys?: SecretKey[];
        }
        export interface SetAppSecretRequest {
            value?: string;
        }
        export interface SetAppSecretResponse {
            /**
             * DEPRECATED
             */
            Version?: number;
            created_at?: string;
            digest?: string;
            name?: string;
            updated_at?: string;
            value?: string;
            version?: number;
        }
        export interface SetSecretkeyRequest {
            type?: string;
            value?: number[];
        }
        export interface SetSecretkeyResponse {
            /**
             * DEPRECATED
             */
            Version?: number;
            created_at?: string;
            name?: string;
            public_key?: number[];
            type?: string;
            updated_at?: string;
            version?: number;
        }
        export interface SignSecretkeyRequest {
            plaintext?: number[];
        }
        export interface SignSecretkeyResponse {
            signature?: number[];
        }
        export interface SignalRequest {
            signal?: "SIGABRT" | "SIGALRM" | "SIGFPE" | "SIGHUP" | "SIGILL" | "SIGINT" | "SIGKILL" | "SIGPIPE" | "SIGQUIT" | "SIGSEGV" | "SIGTERM" | "SIGTRAP" | "SIGUSR1";
        }
        export interface StopRequest {
            signal?: string;
            timeout?: FlyDuration;
        }
        export interface UpdateMachineRequest {
            /**
             * An object defining the Machine configuration
             */
            config?: {
                /**
                 * Optional boolean telling the Machine to destroy itself once it’s complete (default false)
                 */
                auto_destroy?: boolean;
                /**
                 * An optional object that defines one or more named top-level checks. The key for each check is the check name.
                 */
                checks?: {
                    [name: string]: FlyMachineCheck;
                };
                /**
                 * Containers are a list of containers that will run in the machine. Currently restricted to
                 * only specific organizations.
                 */
                containers?: FlyContainerConfig[];
                /**
                 * Deprecated: use Service.Autostart instead
                 */
                disable_machine_autostart?: boolean;
                dns?: FlyDNSConfig;
                /**
                 * An object filled with key/value pairs to be set as environment variables
                 */
                env?: {
                    [name: string]: string;
                };
                files?: /* A file that will be written to the Machine. One of RawValue or SecretName must be set. */ FlyFile[];
                guest?: FlyMachineGuest;
                /**
                 * The docker image to run
                 */
                image?: string;
                init?: FlyMachineInit;
                metadata?: {
                    [name: string]: string;
                };
                metrics?: FlyMachineMetrics;
                mounts?: FlyMachineMount[];
                processes?: FlyMachineProcess[];
                restart?: /* The Machine restart policy defines whether and how flyd restarts a Machine after its main process exits. See https://fly.io/docs/machines/guides-examples/machine-restart-policy/. */ FlyMachineRestart;
                schedule?: string;
                services?: FlyMachineService[];
                /**
                 * Deprecated: use Guest instead
                 */
                size?: string;
                /**
                 * Standbys enable a machine to be a standby for another. In the event of a hardware failure,
                 * the standby machine will be started.
                 */
                standbys?: string[];
                statics?: FlyStatic[];
                stop_config?: FlyStopConfig;
            };
            current_version?: string;
            lease_ttl?: number;
            lsvd?: boolean;
            min_secrets_version?: number;
            /**
             * Unique name for this Machine. If omitted, one is generated for you
             */
            name?: string;
            /**
             * The target region. Omitting this param launches in the same region as your WireGuard peer connection (somewhere near you).
             */
            region?: string;
            skip_launch?: boolean;
            skip_secrets?: boolean;
            skip_service_registration?: boolean;
        }
        export interface UpdateVolumeRequest {
            auto_backup_enabled?: boolean;
            snapshot_retention?: number;
        }
        export interface VerifySecretkeyRequest {
            plaintext?: number[];
            signature?: number[];
        }
        export interface Volume {
            attached_alloc_id?: string;
            attached_machine_id?: string;
            auto_backup_enabled?: boolean;
            block_size?: number;
            blocks?: number;
            blocks_avail?: number;
            blocks_free?: number;
            bytes_total?: number;
            bytes_used?: number;
            created_at?: string;
            encrypted?: boolean;
            fstype?: string;
            host_status?: "ok" | "unknown" | "unreachable";
            id?: string;
            name?: string;
            region?: string;
            size_gb?: number;
            snapshot_retention?: number;
            state?: string;
            zone?: string;
        }
        export interface VolumeSnapshot {
            created_at?: string;
            digest?: string;
            id?: string;
            retention_days?: number;
            size?: number;
            status?: string;
            volume_size?: number;
        }
    }
}
declare namespace Paths {
    namespace AppCreateDeployToken {
        namespace Parameters {
            export type AppName = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
        }
        export type RequestBody = Components.Schemas.CreateAppDeployTokenRequest;
        namespace Responses {
            export type $200 = Components.Schemas.CreateAppResponse;
        }
    }
    namespace AppIPAssignmentsCreate {
        export type RequestBody = Components.Schemas.AssignIPRequest;
        namespace Responses {
            export type $200 = Components.Schemas.IPAssignment;
        }
    }
    namespace AppIPAssignmentsList {
        namespace Responses {
            export type $200 = Components.Schemas.ListIPAssignmentsResponse;
        }
    }
    namespace AppsCreate {
        export type RequestBody = Components.Schemas.CreateAppRequest;
        namespace Responses {
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
    namespace AppsDelete {
        namespace Parameters {
            export type AppName = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
        }
    }
    namespace AppsList {
        namespace Parameters {
            export type AppRole = string;
            export type OrgSlug = string;
        }
        export interface QueryParameters {
            org_slug: Parameters.OrgSlug;
            app_role?: Parameters.AppRole;
        }
        namespace Responses {
            export type $200 = Components.Schemas.ListAppsResponse;
        }
    }
    namespace AppsShow {
        namespace Parameters {
            export type AppName = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
        }
        namespace Responses {
            export type $200 = Components.Schemas.App;
        }
    }
    namespace CreateVolumeSnapshot {
        namespace Parameters {
            export type AppName = string;
            export type VolumeId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            volume_id: Parameters.VolumeId;
        }
    }
    namespace CurrentTokenShow {
        namespace Responses {
            export type $200 = Components.Schemas.CurrentTokenResponse;
            export type $401 = Components.Schemas.ErrorResponse;
            export type $500 = Components.Schemas.ErrorResponse;
        }
    }
    namespace MachinesCordon {
        namespace Parameters {
            export type AppName = string;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
    }
    namespace MachinesCreate {
        namespace Parameters {
            export type AppName = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
        }
        export type RequestBody = Components.Schemas.CreateMachineRequest;
        namespace Responses {
            export type $200 = Components.Schemas.Machine;
        }
    }
    namespace MachinesCreateLease {
        export interface HeaderParameters {
            "fly-machine-lease-nonce"?: Parameters.FlyMachineLeaseNonce;
        }
        namespace Parameters {
            export type AppName = string;
            export type FlyMachineLeaseNonce = string;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
        export type RequestBody = Components.Schemas.CreateLeaseRequest;
        namespace Responses {
            export type $200 = Components.Schemas.Lease;
        }
    }
    namespace MachinesDelete {
        namespace Parameters {
            export type AppName = string;
            export type Force = boolean;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
        export interface QueryParameters {
            force?: Parameters.Force;
        }
    }
    namespace MachinesDeleteMetadata {
        namespace Parameters {
            export type AppName = string;
            export type Key = string;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
            key: Parameters.Key;
        }
    }
    namespace MachinesExec {
        namespace Parameters {
            export type AppName = string;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
        export type RequestBody = Components.Schemas.MachineExecRequest;
        namespace Responses {
            export type $200 = Components.Schemas.Flydv1ExecResponse;
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
    namespace MachinesList {
        namespace Parameters {
            export type AppName = string;
            export type IncludeDeleted = boolean;
            export type Region = string;
            export type State = string;
            export type Summary = boolean;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
        }
        export interface QueryParameters {
            include_deleted?: Parameters.IncludeDeleted;
            region?: Parameters.Region;
            state?: Parameters.State;
            summary?: Parameters.Summary;
        }
        namespace Responses {
            export type $200 = Components.Schemas.Machine[];
        }
    }
    namespace MachinesListEvents {
        namespace Parameters {
            export type AppName = string;
            export type Limit = number;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
        export interface QueryParameters {
            limit?: Parameters.Limit;
        }
        namespace Responses {
            export type $200 = Components.Schemas.MachineEvent[];
        }
    }
    namespace MachinesListProcesses {
        namespace Parameters {
            export type AppName = string;
            export type MachineId = string;
            export type Order = string;
            export type SortBy = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
        export interface QueryParameters {
            sort_by?: Parameters.SortBy;
            order?: Parameters.Order;
        }
        namespace Responses {
            export type $200 = Components.Schemas.ProcessStat[];
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
    namespace MachinesListVersions {
        namespace Parameters {
            export type AppName = string;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
        namespace Responses {
            export type $200 = Components.Schemas.MachineVersion[];
        }
    }
    namespace MachinesPatchMetadata {
        namespace Parameters {
            export type AppName = string;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
        namespace Responses {
            export type $400 = Components.Schemas.ErrorResponse;
            export type $412 = Components.Schemas.ErrorResponse;
        }
    }
    namespace MachinesReclaimMemory {
        namespace Parameters {
            export type AppName = string;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
        export type RequestBody = Components.Schemas.MainReclaimMemoryRequest;
        namespace Responses {
            export type $200 = Components.Schemas.MainReclaimMemoryResponse;
        }
    }
    namespace MachinesReleaseLease {
        export interface HeaderParameters {
            "fly-machine-lease-nonce": Parameters.FlyMachineLeaseNonce;
        }
        namespace Parameters {
            export type AppName = string;
            export type FlyMachineLeaseNonce = string;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
    }
    namespace MachinesRestart {
        namespace Parameters {
            export type AppName = string;
            export type MachineId = string;
            export type Signal = string;
            export type Timeout = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
        export interface QueryParameters {
            timeout?: Parameters.Timeout;
            signal?: Parameters.Signal;
        }
        namespace Responses {
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
    namespace MachinesShow {
        namespace Parameters {
            export type AppName = string;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
        namespace Responses {
            export type $200 = Components.Schemas.Machine;
        }
    }
    namespace MachinesShowLease {
        namespace Parameters {
            export type AppName = string;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
        namespace Responses {
            export type $200 = Components.Schemas.Lease;
        }
    }
    namespace MachinesShowMetadata {
        namespace Parameters {
            export type AppName = string;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
        namespace Responses {
            export interface $200 {
                [name: string]: string;
            }
        }
    }
    namespace MachinesSignal {
        namespace Parameters {
            export type AppName = string;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
        export type RequestBody = Components.Schemas.SignalRequest;
        namespace Responses {
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
    namespace MachinesStart {
        namespace Parameters {
            export type AppName = string;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
    }
    namespace MachinesStop {
        namespace Parameters {
            export type AppName = string;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
        export type RequestBody = Components.Schemas.StopRequest;
        namespace Responses {
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
    namespace MachinesSuspend {
        namespace Parameters {
            export type AppName = string;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
    }
    namespace MachinesUncordon {
        namespace Parameters {
            export type AppName = string;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
    }
    namespace MachinesUpdate {
        namespace Parameters {
            export type AppName = string;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
        export type RequestBody = Components.Schemas.UpdateMachineRequest;
        namespace Responses {
            export type $200 = Components.Schemas.Machine;
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
    namespace MachinesUpdateMetadata {
        namespace Parameters {
            export type AppName = string;
            export type Key = string;
            export type MachineId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
            key: Parameters.Key;
        }
        namespace Responses {
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
    namespace MachinesWait {
        namespace Parameters {
            export type AppName = string;
            export type InstanceId = string;
            export type MachineId = string;
            export type State = "started" | "stopped" | "suspended" | "destroyed";
            export type Timeout = number;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            machine_id: Parameters.MachineId;
        }
        export interface QueryParameters {
            instance_id?: Parameters.InstanceId;
            timeout?: Parameters.Timeout;
            state?: Parameters.State;
        }
        namespace Responses {
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
    namespace PlatformPlacementsPost {
        export type RequestBody = Components.Schemas.MainGetPlacementsRequest;
        namespace Responses {
            export type $200 = Components.Schemas.MainGetPlacementsResponse;
        }
    }
    namespace PlatformRegionsGet {
        namespace Parameters {
            export type CpuKind = string;
            export type Cpus = number;
            export type GpuKind = string;
            export type Gpus = number;
            export type MemoryMb = number;
            export type Size = string;
        }
        export interface QueryParameters {
            size?: Parameters.Size;
            cpu_kind?: Parameters.CpuKind;
            memory_mb?: Parameters.MemoryMb;
            cpus?: Parameters.Cpus;
            gpus?: Parameters.Gpus;
            gpu_kind?: Parameters.GpuKind;
        }
        namespace Responses {
            export type $200 = Components.Schemas.MainRegionResponse;
        }
    }
    namespace SecretCreate {
        namespace Parameters {
            export type AppName = string;
            export type SecretName = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            secret_name: Parameters.SecretName;
        }
        export type RequestBody = Components.Schemas.SetAppSecretRequest;
        namespace Responses {
            export type $201 = Components.Schemas.SetAppSecretResponse;
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
    namespace SecretDelete {
        namespace Parameters {
            export type AppName = string;
            export type SecretName = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            secret_name: Parameters.SecretName;
        }
        namespace Responses {
            export type $200 = Components.Schemas.DeleteAppSecretResponse;
        }
    }
    namespace SecretGet {
        namespace Parameters {
            export type AppName = string;
            export type MinVersion = string;
            export type SecretName = string;
            export type ShowSecrets = boolean;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            secret_name: Parameters.SecretName;
        }
        export interface QueryParameters {
            min_version?: Parameters.MinVersion;
            show_secrets?: Parameters.ShowSecrets;
        }
        namespace Responses {
            export type $200 = Components.Schemas.AppSecret;
        }
    }
    namespace SecretkeyDecrypt {
        namespace Parameters {
            export type AppName = string;
            export type MinVersion = string;
            export type SecretName = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            secret_name: Parameters.SecretName;
        }
        export interface QueryParameters {
            min_version?: Parameters.MinVersion;
        }
        export type RequestBody = Components.Schemas.DecryptSecretkeyRequest;
        namespace Responses {
            export type $200 = Components.Schemas.DecryptSecretkeyResponse;
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
    namespace SecretkeyDelete {
        namespace Parameters {
            export type AppName = string;
            export type SecretName = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            secret_name: Parameters.SecretName;
        }
        namespace Responses {
            export type $200 = Components.Schemas.DeleteSecretkeyResponse;
        }
    }
    namespace SecretkeyEncrypt {
        namespace Parameters {
            export type AppName = string;
            export type MinVersion = string;
            export type SecretName = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            secret_name: Parameters.SecretName;
        }
        export interface QueryParameters {
            min_version?: Parameters.MinVersion;
        }
        export type RequestBody = Components.Schemas.EncryptSecretkeyRequest;
        namespace Responses {
            export type $200 = Components.Schemas.EncryptSecretkeyResponse;
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
    namespace SecretkeyGenerate {
        namespace Parameters {
            export type AppName = string;
            export type SecretName = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            secret_name: Parameters.SecretName;
        }
        export type RequestBody = Components.Schemas.SetSecretkeyRequest;
        namespace Responses {
            export type $201 = Components.Schemas.SetSecretkeyResponse;
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
    namespace SecretkeyGet {
        namespace Parameters {
            export type AppName = string;
            export type MinVersion = string;
            export type SecretName = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            secret_name: Parameters.SecretName;
        }
        export interface QueryParameters {
            min_version?: Parameters.MinVersion;
        }
        namespace Responses {
            export type $200 = Components.Schemas.SecretKey;
        }
    }
    namespace SecretkeySet {
        namespace Parameters {
            export type AppName = string;
            export type SecretName = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            secret_name: Parameters.SecretName;
        }
        export type RequestBody = Components.Schemas.SetSecretkeyRequest;
        namespace Responses {
            export type $201 = Components.Schemas.SetSecretkeyResponse;
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
    namespace SecretkeySign {
        namespace Parameters {
            export type AppName = string;
            export type MinVersion = string;
            export type SecretName = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            secret_name: Parameters.SecretName;
        }
        export interface QueryParameters {
            min_version?: Parameters.MinVersion;
        }
        export type RequestBody = Components.Schemas.SignSecretkeyRequest;
        namespace Responses {
            export type $200 = Components.Schemas.SignSecretkeyResponse;
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
    namespace SecretkeyVerify {
        namespace Parameters {
            export type AppName = string;
            export type MinVersion = string;
            export type SecretName = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            secret_name: Parameters.SecretName;
        }
        export interface QueryParameters {
            min_version?: Parameters.MinVersion;
        }
        export type RequestBody = Components.Schemas.VerifySecretkeyRequest;
        namespace Responses {
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
    namespace SecretkeysList {
        namespace Parameters {
            export type AppName = string;
            export type MinVersion = string;
            export type Types = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
        }
        export interface QueryParameters {
            min_version?: Parameters.MinVersion;
            types?: Parameters.Types;
        }
        namespace Responses {
            export type $200 = Components.Schemas.SecretKeys;
        }
    }
    namespace SecretsList {
        namespace Parameters {
            export type AppName = string;
            export type MinVersion = string;
            export type ShowSecrets = boolean;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
        }
        export interface QueryParameters {
            min_version?: Parameters.MinVersion;
            show_secrets?: Parameters.ShowSecrets;
        }
        namespace Responses {
            export type $200 = Components.Schemas.AppSecrets;
        }
    }
    namespace SecretsUpdate {
        namespace Parameters {
            export type AppName = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
        }
        export type RequestBody = Components.Schemas.AppSecretsUpdateRequest;
        namespace Responses {
            export type $200 = Components.Schemas.AppSecretsUpdateResp;
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
    namespace TokensRequestKms {
        namespace Responses {
            export type $200 = string;
        }
    }
    namespace TokensRequestOIDC {
        export type RequestBody = /* Optional parameters */ Components.Schemas.CreateOIDCTokenRequest;
        namespace Responses {
            export type $200 = string;
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
    namespace VolumeDelete {
        namespace Parameters {
            export type AppName = string;
            export type VolumeId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            volume_id: Parameters.VolumeId;
        }
        namespace Responses {
            export type $200 = Components.Schemas.Volume;
        }
    }
    namespace VolumesCreate {
        namespace Parameters {
            export type AppName = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
        }
        export type RequestBody = Components.Schemas.CreateVolumeRequest;
        namespace Responses {
            export type $200 = Components.Schemas.Volume;
        }
    }
    namespace VolumesExtend {
        namespace Parameters {
            export type AppName = string;
            export type VolumeId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            volume_id: Parameters.VolumeId;
        }
        export type RequestBody = Components.Schemas.ExtendVolumeRequest;
        namespace Responses {
            export type $200 = Components.Schemas.ExtendVolumeResponse;
        }
    }
    namespace VolumesGetById {
        namespace Parameters {
            export type AppName = string;
            export type VolumeId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            volume_id: Parameters.VolumeId;
        }
        namespace Responses {
            export type $200 = Components.Schemas.Volume;
        }
    }
    namespace VolumesList {
        namespace Parameters {
            export type AppName = string;
            export type Summary = boolean;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
        }
        export interface QueryParameters {
            summary?: Parameters.Summary;
        }
        namespace Responses {
            export type $200 = Components.Schemas.Volume[];
        }
    }
    namespace VolumesListSnapshots {
        namespace Parameters {
            export type AppName = string;
            export type VolumeId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            volume_id: Parameters.VolumeId;
        }
        namespace Responses {
            export type $200 = Components.Schemas.VolumeSnapshot[];
        }
    }
    namespace VolumesUpdate {
        namespace Parameters {
            export type AppName = string;
            export type VolumeId = string;
        }
        export interface PathParameters {
            app_name: Parameters.AppName;
            volume_id: Parameters.VolumeId;
        }
        export type RequestBody = Components.Schemas.UpdateVolumeRequest;
        namespace Responses {
            export type $200 = Components.Schemas.Volume;
            export type $400 = Components.Schemas.ErrorResponse;
        }
    }
}


export interface OperationMethods {
  /**
   * Apps_list - List Apps
   *
   * List all apps with the ability to filter by organization slug.
   *
   */
  'Apps_list'(
    parameters?: Parameters<Paths.AppsList.QueryParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.AppsList.Responses.$200>
  /**
   * Apps_create - Create App
   *
   * Create an app with the specified details in the request body.
   *
   */
  'Apps_create'(
    parameters?: Parameters<UnknownParamsObject> | null,
    data?: Paths.AppsCreate.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<any>
  /**
   * Apps_show - Get App
   *
   * Retrieve details about a specific app by its name.
   *
   */
  'Apps_show'(
    parameters?: Parameters<Paths.AppsShow.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.AppsShow.Responses.$200>
  /**
   * Apps_delete - Destroy App
   *
   * Delete an app by its name.
   *
   */
  'Apps_delete'(
    parameters?: Parameters<Paths.AppsDelete.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<any>
  /**
   * App_create_deploy_token - Create App deploy token
   */
  'App_create_deploy_token'(
    parameters?: Parameters<Paths.AppCreateDeployToken.PathParameters> | null,
    data?: Paths.AppCreateDeployToken.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.AppCreateDeployToken.Responses.$200>
  /**
   * App_IPAssignments_list - List IP assignments for app
   */
  'App_IPAssignments_list'(
    parameters?: Parameters<UnknownParamsObject> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.AppIPAssignmentsList.Responses.$200>
  /**
   * App_IPAssignments_create - Assign new IP address to app
   */
  'App_IPAssignments_create'(
    parameters?: Parameters<UnknownParamsObject> | null,
    data?: Paths.AppIPAssignmentsCreate.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.AppIPAssignmentsCreate.Responses.$200>
  /**
   * App_IPAssignments_delete - Remove IP assignment from app
   */
  'App_IPAssignments_delete'(
    parameters?: Parameters<UnknownParamsObject> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<any>
  /**
   * Machines_list - List Machines
   *
   * List all Machines associated with a specific app, with optional filters for including deleted Machines and filtering by region.
   *
   */
  'Machines_list'(
    parameters?: Parameters<Paths.MachinesList.QueryParameters & Paths.MachinesList.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.MachinesList.Responses.$200>
  /**
   * Machines_create - Create Machine
   *
   * Create a Machine within a specific app using the details provided in the request body.
   *
   * **Important**: This request can fail, and you’re responsible for handling that failure. If you ask for a large Machine, or a Machine in a region we happen to be at capacity for, you might need to retry the request, or to fall back to another region. If you’re working directly with the Machines API, you’re taking some responsibility for your own orchestration!
   *
   */
  'Machines_create'(
    parameters?: Parameters<Paths.MachinesCreate.PathParameters> | null,
    data?: Paths.MachinesCreate.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.MachinesCreate.Responses.$200>
  /**
   * Machines_show - Get Machine
   *
   * Get details of a specific Machine within an app by the Machine ID.
   *
   */
  'Machines_show'(
    parameters?: Parameters<Paths.MachinesShow.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.MachinesShow.Responses.$200>
  /**
   * Machines_update - Update Machine
   *
   * Update a Machine's configuration using the details provided in the request body.
   *
   */
  'Machines_update'(
    parameters?: Parameters<Paths.MachinesUpdate.PathParameters> | null,
    data?: Paths.MachinesUpdate.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.MachinesUpdate.Responses.$200>
  /**
   * Machines_delete - Destroy Machine
   *
   * Delete a specific Machine within an app by Machine ID, with an optional force parameter to force kill the Machine if it's running.
   *
   */
  'Machines_delete'(
    parameters?: Parameters<Paths.MachinesDelete.QueryParameters & Paths.MachinesDelete.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<any>
  /**
   * Machines_cordon - Cordon Machine
   *
   * “Cordoning” a Machine refers to disabling its services, so the Fly Proxy won’t route requests to it. In flyctl this is used by blue/green deployments; one set of Machines is started up with services disabled, and when they are all healthy, the services are enabled on the new Machines and disabled on the old ones.
   *
   */
  'Machines_cordon'(
    parameters?: Parameters<Paths.MachinesCordon.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<any>
  /**
   * Machines_list_events - List Events
   *
   * List all events associated with a specific Machine within an app.
   *
   */
  'Machines_list_events'(
    parameters?: Parameters<Paths.MachinesListEvents.QueryParameters & Paths.MachinesListEvents.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.MachinesListEvents.Responses.$200>
  /**
   * Machines_exec - Execute Command
   *
   * Execute a command on a specific Machine and return the raw command output bytes.
   *
   */
  'Machines_exec'(
    parameters?: Parameters<Paths.MachinesExec.PathParameters> | null,
    data?: Paths.MachinesExec.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.MachinesExec.Responses.$200>
  /**
   * Machines_show_lease - Get Lease
   *
   * Retrieve the current lease of a specific Machine within an app. Machine leases can be used to obtain an exclusive lock on modifying a Machine.
   *
   */
  'Machines_show_lease'(
    parameters?: Parameters<Paths.MachinesShowLease.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.MachinesShowLease.Responses.$200>
  /**
   * Machines_create_lease - Create Lease
   *
   * Create a lease for a specific Machine within an app using the details provided in the request body. Machine leases can be used to obtain an exclusive lock on modifying a Machine.
   *
   */
  'Machines_create_lease'(
    parameters?: Parameters<Paths.MachinesCreateLease.HeaderParameters & Paths.MachinesCreateLease.PathParameters> | null,
    data?: Paths.MachinesCreateLease.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.MachinesCreateLease.Responses.$200>
  /**
   * Machines_release_lease - Release Lease
   *
   * Release the lease of a specific Machine within an app. Machine leases can be used to obtain an exclusive lock on modifying a Machine.
   *
   */
  'Machines_release_lease'(
    parameters?: Parameters<Paths.MachinesReleaseLease.HeaderParameters & Paths.MachinesReleaseLease.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<any>
  /**
   * Machines_reclaim_memory - Reclaim Machine Memory
   *
   * Trigger the balloon device to reclaim memory from a machine
   */
  'Machines_reclaim_memory'(
    parameters?: Parameters<Paths.MachinesReclaimMemory.PathParameters> | null,
    data?: Paths.MachinesReclaimMemory.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.MachinesReclaimMemory.Responses.$200>
  /**
   * Machines_show_metadata - Get Metadata
   *
   * Retrieve metadata for a specific Machine within an app.
   *
   */
  'Machines_show_metadata'(
    parameters?: Parameters<Paths.MachinesShowMetadata.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.MachinesShowMetadata.Responses.$200>
  /**
   * Machines_patch_metadata - Patch Metadata (set/remove multiple keys)
   *
   * Update multiple metadata keys at once. Null values and empty strings remove keys.
   * + If `machine_version` is provided and no longer matches the current machine version, returns 412 Precondition Failed.
   */
  'Machines_patch_metadata'(
    parameters?: Parameters<Paths.MachinesPatchMetadata.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<any>
  /**
   * Machines_update_metadata - Update Metadata
   *
   * Update metadata for a specific machine within an app by providing a metadata key.
   *
   */
  'Machines_update_metadata'(
    parameters?: Parameters<Paths.MachinesUpdateMetadata.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<any>
  /**
   * Machines_delete_metadata - Delete Metadata
   *
   * Delete metadata for a specific Machine within an app by providing a metadata key.
   *
   */
  'Machines_delete_metadata'(
    parameters?: Parameters<Paths.MachinesDeleteMetadata.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<any>
  /**
   * Machines_list_processes - List Processes
   *
   * List all processes running on a specific Machine within an app, with optional sorting parameters.
   *
   */
  'Machines_list_processes'(
    parameters?: Parameters<Paths.MachinesListProcesses.QueryParameters & Paths.MachinesListProcesses.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.MachinesListProcesses.Responses.$200>
  /**
   * Machines_restart - Restart Machine
   *
   * Restart a specific Machine within an app, with an optional timeout parameter.
   *
   */
  'Machines_restart'(
    parameters?: Parameters<Paths.MachinesRestart.QueryParameters & Paths.MachinesRestart.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<any>
  /**
   * Machines_signal - Signal Machine
   *
   * Send a signal to a specific Machine within an app using the details provided in the request body.
   *
   */
  'Machines_signal'(
    parameters?: Parameters<Paths.MachinesSignal.PathParameters> | null,
    data?: Paths.MachinesSignal.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<any>
  /**
   * Machines_start - Start Machine
   *
   * Start a specific Machine within an app.
   *
   */
  'Machines_start'(
    parameters?: Parameters<Paths.MachinesStart.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<any>
  /**
   * Machines_stop - Stop Machine
   *
   * Stop a specific Machine within an app, with an optional request body to specify signal and timeout.
   *
   */
  'Machines_stop'(
    parameters?: Parameters<Paths.MachinesStop.PathParameters> | null,
    data?: Paths.MachinesStop.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<any>
  /**
   * Machines_suspend - Suspend Machine
   *
   * Suspend a specific Machine within an app. The next start operation will attempt (but is not guaranteed) to resume the Machine from a snapshot taken at suspension time, rather than performing a cold boot.
   *
   */
  'Machines_suspend'(
    parameters?: Parameters<Paths.MachinesSuspend.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<any>
  /**
   * Machines_uncordon - Uncordon Machine
   *
   * “Cordoning” a Machine refers to disabling its services, so the Fly Proxy won’t route requests to it. In flyctl this is used by blue/green deployments; one set of Machines is started up with services disabled, and when they are all healthy, the services are enabled on the new Machines and disabled on the old ones.
   *
   */
  'Machines_uncordon'(
    parameters?: Parameters<Paths.MachinesUncordon.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<any>
  /**
   * Machines_list_versions - List Versions
   *
   * List all versions of the configuration for a specific Machine within an app.
   *
   */
  'Machines_list_versions'(
    parameters?: Parameters<Paths.MachinesListVersions.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.MachinesListVersions.Responses.$200>
  /**
   * Machines_wait - Wait for State
   *
   * Wait for a Machine to reach a specific state. Specify the desired state with the state parameter. See the [Machine states table](https://fly.io/docs/machines/working-with-machines/#machine-states) for a list of possible states. The default for this parameter is `started`.
   *
   * This request will block for up to 60 seconds. Set a shorter timeout with the timeout parameter.
   *
   */
  'Machines_wait'(
    parameters?: Parameters<Paths.MachinesWait.QueryParameters & Paths.MachinesWait.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<any>
  /**
   * Secretkeys_list - List secret keys belonging to an app
   */
  'Secretkeys_list'(
    parameters?: Parameters<Paths.SecretkeysList.QueryParameters & Paths.SecretkeysList.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.SecretkeysList.Responses.$200>
  /**
   * Secretkey_get - Get an app's secret key
   */
  'Secretkey_get'(
    parameters?: Parameters<Paths.SecretkeyGet.QueryParameters & Paths.SecretkeyGet.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.SecretkeyGet.Responses.$200>
  /**
   * Secretkey_set - Create or update a secret key
   */
  'Secretkey_set'(
    parameters?: Parameters<Paths.SecretkeySet.PathParameters> | null,
    data?: Paths.SecretkeySet.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.SecretkeySet.Responses.$201>
  /**
   * Secretkey_delete - Delete an app's secret key
   */
  'Secretkey_delete'(
    parameters?: Parameters<Paths.SecretkeyDelete.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.SecretkeyDelete.Responses.$200>
  /**
   * Secretkey_decrypt - Decrypt with a secret key
   */
  'Secretkey_decrypt'(
    parameters?: Parameters<Paths.SecretkeyDecrypt.QueryParameters & Paths.SecretkeyDecrypt.PathParameters> | null,
    data?: Paths.SecretkeyDecrypt.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.SecretkeyDecrypt.Responses.$200>
  /**
   * Secretkey_encrypt - Encrypt with a secret key
   */
  'Secretkey_encrypt'(
    parameters?: Parameters<Paths.SecretkeyEncrypt.QueryParameters & Paths.SecretkeyEncrypt.PathParameters> | null,
    data?: Paths.SecretkeyEncrypt.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.SecretkeyEncrypt.Responses.$200>
  /**
   * Secretkey_generate - Generate a random secret key
   */
  'Secretkey_generate'(
    parameters?: Parameters<Paths.SecretkeyGenerate.PathParameters> | null,
    data?: Paths.SecretkeyGenerate.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.SecretkeyGenerate.Responses.$201>
  /**
   * Secretkey_sign - Sign with a secret key
   */
  'Secretkey_sign'(
    parameters?: Parameters<Paths.SecretkeySign.QueryParameters & Paths.SecretkeySign.PathParameters> | null,
    data?: Paths.SecretkeySign.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.SecretkeySign.Responses.$200>
  /**
   * Secretkey_verify - Verify with a secret key
   */
  'Secretkey_verify'(
    parameters?: Parameters<Paths.SecretkeyVerify.QueryParameters & Paths.SecretkeyVerify.PathParameters> | null,
    data?: Paths.SecretkeyVerify.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<any>
  /**
   * Secrets_list - List app secrets belonging to an app
   */
  'Secrets_list'(
    parameters?: Parameters<Paths.SecretsList.QueryParameters & Paths.SecretsList.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.SecretsList.Responses.$200>
  /**
   * Secrets_update - Update app secrets belonging to an app
   */
  'Secrets_update'(
    parameters?: Parameters<Paths.SecretsUpdate.PathParameters> | null,
    data?: Paths.SecretsUpdate.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.SecretsUpdate.Responses.$200>
  /**
   * Secret_get - Get an app secret
   */
  'Secret_get'(
    parameters?: Parameters<Paths.SecretGet.QueryParameters & Paths.SecretGet.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.SecretGet.Responses.$200>
  /**
   * Secret_create - Create or update Secret
   */
  'Secret_create'(
    parameters?: Parameters<Paths.SecretCreate.PathParameters> | null,
    data?: Paths.SecretCreate.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.SecretCreate.Responses.$201>
  /**
   * Secret_delete - Delete an app secret
   */
  'Secret_delete'(
    parameters?: Parameters<Paths.SecretDelete.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.SecretDelete.Responses.$200>
  /**
   * Volumes_list - List Volumes
   *
   * List all volumes associated with a specific app.
   *
   */
  'Volumes_list'(
    parameters?: Parameters<Paths.VolumesList.QueryParameters & Paths.VolumesList.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.VolumesList.Responses.$200>
  /**
   * Volumes_create - Create Volume
   *
   * Create a volume for a specific app using the details provided in the request body.
   *
   */
  'Volumes_create'(
    parameters?: Parameters<Paths.VolumesCreate.PathParameters> | null,
    data?: Paths.VolumesCreate.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.VolumesCreate.Responses.$200>
  /**
   * Volumes_get_by_id - Get Volume
   *
   * Retrieve details about a specific volume by its ID within an app.
   *
   */
  'Volumes_get_by_id'(
    parameters?: Parameters<Paths.VolumesGetById.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.VolumesGetById.Responses.$200>
  /**
   * Volumes_update - Update Volume
   *
   * Update a volume's configuration using the details provided in the request body.
   *
   */
  'Volumes_update'(
    parameters?: Parameters<Paths.VolumesUpdate.PathParameters> | null,
    data?: Paths.VolumesUpdate.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.VolumesUpdate.Responses.$200>
  /**
   * Volume_delete - Destroy Volume
   *
   * Delete a specific volume within an app by volume ID.
   *
   */
  'Volume_delete'(
    parameters?: Parameters<Paths.VolumeDelete.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.VolumeDelete.Responses.$200>
  /**
   * Volumes_extend - Extend Volume
   *
   * Extend a volume's size within an app using the details provided in the request body.
   *
   */
  'Volumes_extend'(
    parameters?: Parameters<Paths.VolumesExtend.PathParameters> | null,
    data?: Paths.VolumesExtend.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.VolumesExtend.Responses.$200>
  /**
   * Volumes_list_snapshots - List Snapshots
   *
   * List all snapshots for a specific volume within an app.
   *
   */
  'Volumes_list_snapshots'(
    parameters?: Parameters<Paths.VolumesListSnapshots.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.VolumesListSnapshots.Responses.$200>
  /**
   * createVolumeSnapshot - Create Snapshot
   *
   * Create a snapshot for a specific volume within an app.
   *
   */
  'createVolumeSnapshot'(
    parameters?: Parameters<Paths.CreateVolumeSnapshot.PathParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<any>
  /**
   * Platform_placements_post - Get Placements
   *
   * Simulates placing the specified number of machines into regions, depending on available capacity and limits.
   */
  'Platform_placements_post'(
    parameters?: Parameters<UnknownParamsObject> | null,
    data?: Paths.PlatformPlacementsPost.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.PlatformPlacementsPost.Responses.$200>
  /**
   * Platform_regions_get - Get Regions
   *
   * List all regions on the platform with their current Machine capacity.
   */
  'Platform_regions_get'(
    parameters?: Parameters<Paths.PlatformRegionsGet.QueryParameters> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.PlatformRegionsGet.Responses.$200>
  /**
   * Tokens_request_Kms - Request a Petsem token for accessing KMS
   *
   * This site hosts documentation generated from the Fly.io Machines API OpenAPI specification. Visit our complete [Machines API docs](https://fly.io/docs/machines/api/apps-resource/) for details about using the Apps resource.
   */
  'Tokens_request_Kms'(
    parameters?: Parameters<UnknownParamsObject> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.TokensRequestKms.Responses.$200>
  /**
   * Tokens_request_OIDC - Request an OIDC token
   *
   * Request an Open ID Connect token for your machine. Customize the audience claim with the `aud` parameter. This returns a JWT token. Learn more about [using OpenID Connect](/docs/reference/openid-connect/) on Fly.io.
   *
   */
  'Tokens_request_OIDC'(
    parameters?: Parameters<UnknownParamsObject> | null,
    data?: Paths.TokensRequestOIDC.RequestBody,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.TokensRequestOIDC.Responses.$200>
  /**
   * CurrentToken_show - Get Current Token Information
   *
   * Get information about the current macaroon token(s), including organizations, apps, and whether each token is from a user or machine
   */
  'CurrentToken_show'(
    parameters?: Parameters<UnknownParamsObject> | null,
    data?: any,
    config?: AxiosRequestConfig
  ): OperationResponse<Paths.CurrentTokenShow.Responses.$200>
}

export interface PathsDictionary {
  ['/apps']: {
    /**
     * Apps_list - List Apps
     *
     * List all apps with the ability to filter by organization slug.
     *
     */
    'get'(
      parameters?: Parameters<Paths.AppsList.QueryParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.AppsList.Responses.$200>
    /**
     * Apps_create - Create App
     *
     * Create an app with the specified details in the request body.
     *
     */
    'post'(
      parameters?: Parameters<UnknownParamsObject> | null,
      data?: Paths.AppsCreate.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<any>
  }
  ['/apps/{app_name}']: {
    /**
     * Apps_show - Get App
     *
     * Retrieve details about a specific app by its name.
     *
     */
    'get'(
      parameters?: Parameters<Paths.AppsShow.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.AppsShow.Responses.$200>
    /**
     * Apps_delete - Destroy App
     *
     * Delete an app by its name.
     *
     */
    'delete'(
      parameters?: Parameters<Paths.AppsDelete.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<any>
  }
  ['/apps/{app_name}/deploy_token']: {
    /**
     * App_create_deploy_token - Create App deploy token
     */
    'post'(
      parameters?: Parameters<Paths.AppCreateDeployToken.PathParameters> | null,
      data?: Paths.AppCreateDeployToken.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.AppCreateDeployToken.Responses.$200>
  }
  ['/apps/{app_name}/ip_assignments']: {
    /**
     * App_IPAssignments_list - List IP assignments for app
     */
    'get'(
      parameters?: Parameters<UnknownParamsObject> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.AppIPAssignmentsList.Responses.$200>
    /**
     * App_IPAssignments_create - Assign new IP address to app
     */
    'post'(
      parameters?: Parameters<UnknownParamsObject> | null,
      data?: Paths.AppIPAssignmentsCreate.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.AppIPAssignmentsCreate.Responses.$200>
  }
  ['/apps/{app_name}/ip_assignments/{ip}']: {
    /**
     * App_IPAssignments_delete - Remove IP assignment from app
     */
    'delete'(
      parameters?: Parameters<UnknownParamsObject> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<any>
  }
  ['/apps/{app_name}/machines']: {
    /**
     * Machines_list - List Machines
     *
     * List all Machines associated with a specific app, with optional filters for including deleted Machines and filtering by region.
     *
     */
    'get'(
      parameters?: Parameters<Paths.MachinesList.QueryParameters & Paths.MachinesList.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.MachinesList.Responses.$200>
    /**
     * Machines_create - Create Machine
     *
     * Create a Machine within a specific app using the details provided in the request body.
     *
     * **Important**: This request can fail, and you’re responsible for handling that failure. If you ask for a large Machine, or a Machine in a region we happen to be at capacity for, you might need to retry the request, or to fall back to another region. If you’re working directly with the Machines API, you’re taking some responsibility for your own orchestration!
     *
     */
    'post'(
      parameters?: Parameters<Paths.MachinesCreate.PathParameters> | null,
      data?: Paths.MachinesCreate.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.MachinesCreate.Responses.$200>
  }
  ['/apps/{app_name}/machines/{machine_id}']: {
    /**
     * Machines_show - Get Machine
     *
     * Get details of a specific Machine within an app by the Machine ID.
     *
     */
    'get'(
      parameters?: Parameters<Paths.MachinesShow.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.MachinesShow.Responses.$200>
    /**
     * Machines_update - Update Machine
     *
     * Update a Machine's configuration using the details provided in the request body.
     *
     */
    'post'(
      parameters?: Parameters<Paths.MachinesUpdate.PathParameters> | null,
      data?: Paths.MachinesUpdate.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.MachinesUpdate.Responses.$200>
    /**
     * Machines_delete - Destroy Machine
     *
     * Delete a specific Machine within an app by Machine ID, with an optional force parameter to force kill the Machine if it's running.
     *
     */
    'delete'(
      parameters?: Parameters<Paths.MachinesDelete.QueryParameters & Paths.MachinesDelete.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<any>
  }
  ['/apps/{app_name}/machines/{machine_id}/cordon']: {
    /**
     * Machines_cordon - Cordon Machine
     *
     * “Cordoning” a Machine refers to disabling its services, so the Fly Proxy won’t route requests to it. In flyctl this is used by blue/green deployments; one set of Machines is started up with services disabled, and when they are all healthy, the services are enabled on the new Machines and disabled on the old ones.
     *
     */
    'post'(
      parameters?: Parameters<Paths.MachinesCordon.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<any>
  }
  ['/apps/{app_name}/machines/{machine_id}/events']: {
    /**
     * Machines_list_events - List Events
     *
     * List all events associated with a specific Machine within an app.
     *
     */
    'get'(
      parameters?: Parameters<Paths.MachinesListEvents.QueryParameters & Paths.MachinesListEvents.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.MachinesListEvents.Responses.$200>
  }
  ['/apps/{app_name}/machines/{machine_id}/exec']: {
    /**
     * Machines_exec - Execute Command
     *
     * Execute a command on a specific Machine and return the raw command output bytes.
     *
     */
    'post'(
      parameters?: Parameters<Paths.MachinesExec.PathParameters> | null,
      data?: Paths.MachinesExec.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.MachinesExec.Responses.$200>
  }
  ['/apps/{app_name}/machines/{machine_id}/lease']: {
    /**
     * Machines_show_lease - Get Lease
     *
     * Retrieve the current lease of a specific Machine within an app. Machine leases can be used to obtain an exclusive lock on modifying a Machine.
     *
     */
    'get'(
      parameters?: Parameters<Paths.MachinesShowLease.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.MachinesShowLease.Responses.$200>
    /**
     * Machines_create_lease - Create Lease
     *
     * Create a lease for a specific Machine within an app using the details provided in the request body. Machine leases can be used to obtain an exclusive lock on modifying a Machine.
     *
     */
    'post'(
      parameters?: Parameters<Paths.MachinesCreateLease.HeaderParameters & Paths.MachinesCreateLease.PathParameters> | null,
      data?: Paths.MachinesCreateLease.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.MachinesCreateLease.Responses.$200>
    /**
     * Machines_release_lease - Release Lease
     *
     * Release the lease of a specific Machine within an app. Machine leases can be used to obtain an exclusive lock on modifying a Machine.
     *
     */
    'delete'(
      parameters?: Parameters<Paths.MachinesReleaseLease.HeaderParameters & Paths.MachinesReleaseLease.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<any>
  }
  ['/apps/{app_name}/machines/{machine_id}/memory/reclaim']: {
    /**
     * Machines_reclaim_memory - Reclaim Machine Memory
     *
     * Trigger the balloon device to reclaim memory from a machine
     */
    'post'(
      parameters?: Parameters<Paths.MachinesReclaimMemory.PathParameters> | null,
      data?: Paths.MachinesReclaimMemory.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.MachinesReclaimMemory.Responses.$200>
  }
  ['/apps/{app_name}/machines/{machine_id}/metadata']: {
    /**
     * Machines_show_metadata - Get Metadata
     *
     * Retrieve metadata for a specific Machine within an app.
     *
     */
    'get'(
      parameters?: Parameters<Paths.MachinesShowMetadata.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.MachinesShowMetadata.Responses.$200>
    /**
     * Machines_patch_metadata - Patch Metadata (set/remove multiple keys)
     *
     * Update multiple metadata keys at once. Null values and empty strings remove keys.
     * + If `machine_version` is provided and no longer matches the current machine version, returns 412 Precondition Failed.
     */
    'patch'(
      parameters?: Parameters<Paths.MachinesPatchMetadata.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<any>
  }
  ['/apps/{app_name}/machines/{machine_id}/metadata/{key}']: {
    /**
     * Machines_update_metadata - Update Metadata
     *
     * Update metadata for a specific machine within an app by providing a metadata key.
     *
     */
    'post'(
      parameters?: Parameters<Paths.MachinesUpdateMetadata.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<any>
    /**
     * Machines_delete_metadata - Delete Metadata
     *
     * Delete metadata for a specific Machine within an app by providing a metadata key.
     *
     */
    'delete'(
      parameters?: Parameters<Paths.MachinesDeleteMetadata.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<any>
  }
  ['/apps/{app_name}/machines/{machine_id}/ps']: {
    /**
     * Machines_list_processes - List Processes
     *
     * List all processes running on a specific Machine within an app, with optional sorting parameters.
     *
     */
    'get'(
      parameters?: Parameters<Paths.MachinesListProcesses.QueryParameters & Paths.MachinesListProcesses.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.MachinesListProcesses.Responses.$200>
  }
  ['/apps/{app_name}/machines/{machine_id}/restart']: {
    /**
     * Machines_restart - Restart Machine
     *
     * Restart a specific Machine within an app, with an optional timeout parameter.
     *
     */
    'post'(
      parameters?: Parameters<Paths.MachinesRestart.QueryParameters & Paths.MachinesRestart.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<any>
  }
  ['/apps/{app_name}/machines/{machine_id}/signal']: {
    /**
     * Machines_signal - Signal Machine
     *
     * Send a signal to a specific Machine within an app using the details provided in the request body.
     *
     */
    'post'(
      parameters?: Parameters<Paths.MachinesSignal.PathParameters> | null,
      data?: Paths.MachinesSignal.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<any>
  }
  ['/apps/{app_name}/machines/{machine_id}/start']: {
    /**
     * Machines_start - Start Machine
     *
     * Start a specific Machine within an app.
     *
     */
    'post'(
      parameters?: Parameters<Paths.MachinesStart.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<any>
  }
  ['/apps/{app_name}/machines/{machine_id}/stop']: {
    /**
     * Machines_stop - Stop Machine
     *
     * Stop a specific Machine within an app, with an optional request body to specify signal and timeout.
     *
     */
    'post'(
      parameters?: Parameters<Paths.MachinesStop.PathParameters> | null,
      data?: Paths.MachinesStop.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<any>
  }
  ['/apps/{app_name}/machines/{machine_id}/suspend']: {
    /**
     * Machines_suspend - Suspend Machine
     *
     * Suspend a specific Machine within an app. The next start operation will attempt (but is not guaranteed) to resume the Machine from a snapshot taken at suspension time, rather than performing a cold boot.
     *
     */
    'post'(
      parameters?: Parameters<Paths.MachinesSuspend.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<any>
  }
  ['/apps/{app_name}/machines/{machine_id}/uncordon']: {
    /**
     * Machines_uncordon - Uncordon Machine
     *
     * “Cordoning” a Machine refers to disabling its services, so the Fly Proxy won’t route requests to it. In flyctl this is used by blue/green deployments; one set of Machines is started up with services disabled, and when they are all healthy, the services are enabled on the new Machines and disabled on the old ones.
     *
     */
    'post'(
      parameters?: Parameters<Paths.MachinesUncordon.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<any>
  }
  ['/apps/{app_name}/machines/{machine_id}/versions']: {
    /**
     * Machines_list_versions - List Versions
     *
     * List all versions of the configuration for a specific Machine within an app.
     *
     */
    'get'(
      parameters?: Parameters<Paths.MachinesListVersions.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.MachinesListVersions.Responses.$200>
  }
  ['/apps/{app_name}/machines/{machine_id}/wait']: {
    /**
     * Machines_wait - Wait for State
     *
     * Wait for a Machine to reach a specific state. Specify the desired state with the state parameter. See the [Machine states table](https://fly.io/docs/machines/working-with-machines/#machine-states) for a list of possible states. The default for this parameter is `started`.
     *
     * This request will block for up to 60 seconds. Set a shorter timeout with the timeout parameter.
     *
     */
    'get'(
      parameters?: Parameters<Paths.MachinesWait.QueryParameters & Paths.MachinesWait.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<any>
  }
  ['/apps/{app_name}/secretkeys']: {
    /**
     * Secretkeys_list - List secret keys belonging to an app
     */
    'get'(
      parameters?: Parameters<Paths.SecretkeysList.QueryParameters & Paths.SecretkeysList.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.SecretkeysList.Responses.$200>
  }
  ['/apps/{app_name}/secretkeys/{secret_name}']: {
    /**
     * Secretkey_get - Get an app's secret key
     */
    'get'(
      parameters?: Parameters<Paths.SecretkeyGet.QueryParameters & Paths.SecretkeyGet.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.SecretkeyGet.Responses.$200>
    /**
     * Secretkey_set - Create or update a secret key
     */
    'post'(
      parameters?: Parameters<Paths.SecretkeySet.PathParameters> | null,
      data?: Paths.SecretkeySet.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.SecretkeySet.Responses.$201>
    /**
     * Secretkey_delete - Delete an app's secret key
     */
    'delete'(
      parameters?: Parameters<Paths.SecretkeyDelete.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.SecretkeyDelete.Responses.$200>
  }
  ['/apps/{app_name}/secretkeys/{secret_name}/decrypt']: {
    /**
     * Secretkey_decrypt - Decrypt with a secret key
     */
    'post'(
      parameters?: Parameters<Paths.SecretkeyDecrypt.QueryParameters & Paths.SecretkeyDecrypt.PathParameters> | null,
      data?: Paths.SecretkeyDecrypt.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.SecretkeyDecrypt.Responses.$200>
  }
  ['/apps/{app_name}/secretkeys/{secret_name}/encrypt']: {
    /**
     * Secretkey_encrypt - Encrypt with a secret key
     */
    'post'(
      parameters?: Parameters<Paths.SecretkeyEncrypt.QueryParameters & Paths.SecretkeyEncrypt.PathParameters> | null,
      data?: Paths.SecretkeyEncrypt.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.SecretkeyEncrypt.Responses.$200>
  }
  ['/apps/{app_name}/secretkeys/{secret_name}/generate']: {
    /**
     * Secretkey_generate - Generate a random secret key
     */
    'post'(
      parameters?: Parameters<Paths.SecretkeyGenerate.PathParameters> | null,
      data?: Paths.SecretkeyGenerate.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.SecretkeyGenerate.Responses.$201>
  }
  ['/apps/{app_name}/secretkeys/{secret_name}/sign']: {
    /**
     * Secretkey_sign - Sign with a secret key
     */
    'post'(
      parameters?: Parameters<Paths.SecretkeySign.QueryParameters & Paths.SecretkeySign.PathParameters> | null,
      data?: Paths.SecretkeySign.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.SecretkeySign.Responses.$200>
  }
  ['/apps/{app_name}/secretkeys/{secret_name}/verify']: {
    /**
     * Secretkey_verify - Verify with a secret key
     */
    'post'(
      parameters?: Parameters<Paths.SecretkeyVerify.QueryParameters & Paths.SecretkeyVerify.PathParameters> | null,
      data?: Paths.SecretkeyVerify.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<any>
  }
  ['/apps/{app_name}/secrets']: {
    /**
     * Secrets_list - List app secrets belonging to an app
     */
    'get'(
      parameters?: Parameters<Paths.SecretsList.QueryParameters & Paths.SecretsList.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.SecretsList.Responses.$200>
    /**
     * Secrets_update - Update app secrets belonging to an app
     */
    'post'(
      parameters?: Parameters<Paths.SecretsUpdate.PathParameters> | null,
      data?: Paths.SecretsUpdate.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.SecretsUpdate.Responses.$200>
  }
  ['/apps/{app_name}/secrets/{secret_name}']: {
    /**
     * Secret_get - Get an app secret
     */
    'get'(
      parameters?: Parameters<Paths.SecretGet.QueryParameters & Paths.SecretGet.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.SecretGet.Responses.$200>
    /**
     * Secret_create - Create or update Secret
     */
    'post'(
      parameters?: Parameters<Paths.SecretCreate.PathParameters> | null,
      data?: Paths.SecretCreate.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.SecretCreate.Responses.$201>
    /**
     * Secret_delete - Delete an app secret
     */
    'delete'(
      parameters?: Parameters<Paths.SecretDelete.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.SecretDelete.Responses.$200>
  }
  ['/apps/{app_name}/volumes']: {
    /**
     * Volumes_list - List Volumes
     *
     * List all volumes associated with a specific app.
     *
     */
    'get'(
      parameters?: Parameters<Paths.VolumesList.QueryParameters & Paths.VolumesList.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.VolumesList.Responses.$200>
    /**
     * Volumes_create - Create Volume
     *
     * Create a volume for a specific app using the details provided in the request body.
     *
     */
    'post'(
      parameters?: Parameters<Paths.VolumesCreate.PathParameters> | null,
      data?: Paths.VolumesCreate.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.VolumesCreate.Responses.$200>
  }
  ['/apps/{app_name}/volumes/{volume_id}']: {
    /**
     * Volumes_get_by_id - Get Volume
     *
     * Retrieve details about a specific volume by its ID within an app.
     *
     */
    'get'(
      parameters?: Parameters<Paths.VolumesGetById.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.VolumesGetById.Responses.$200>
    /**
     * Volumes_update - Update Volume
     *
     * Update a volume's configuration using the details provided in the request body.
     *
     */
    'put'(
      parameters?: Parameters<Paths.VolumesUpdate.PathParameters> | null,
      data?: Paths.VolumesUpdate.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.VolumesUpdate.Responses.$200>
    /**
     * Volume_delete - Destroy Volume
     *
     * Delete a specific volume within an app by volume ID.
     *
     */
    'delete'(
      parameters?: Parameters<Paths.VolumeDelete.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.VolumeDelete.Responses.$200>
  }
  ['/apps/{app_name}/volumes/{volume_id}/extend']: {
    /**
     * Volumes_extend - Extend Volume
     *
     * Extend a volume's size within an app using the details provided in the request body.
     *
     */
    'put'(
      parameters?: Parameters<Paths.VolumesExtend.PathParameters> | null,
      data?: Paths.VolumesExtend.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.VolumesExtend.Responses.$200>
  }
  ['/apps/{app_name}/volumes/{volume_id}/snapshots']: {
    /**
     * Volumes_list_snapshots - List Snapshots
     *
     * List all snapshots for a specific volume within an app.
     *
     */
    'get'(
      parameters?: Parameters<Paths.VolumesListSnapshots.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.VolumesListSnapshots.Responses.$200>
    /**
     * createVolumeSnapshot - Create Snapshot
     *
     * Create a snapshot for a specific volume within an app.
     *
     */
    'post'(
      parameters?: Parameters<Paths.CreateVolumeSnapshot.PathParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<any>
  }
  ['/platform/placements']: {
    /**
     * Platform_placements_post - Get Placements
     *
     * Simulates placing the specified number of machines into regions, depending on available capacity and limits.
     */
    'post'(
      parameters?: Parameters<UnknownParamsObject> | null,
      data?: Paths.PlatformPlacementsPost.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.PlatformPlacementsPost.Responses.$200>
  }
  ['/platform/regions']: {
    /**
     * Platform_regions_get - Get Regions
     *
     * List all regions on the platform with their current Machine capacity.
     */
    'get'(
      parameters?: Parameters<Paths.PlatformRegionsGet.QueryParameters> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.PlatformRegionsGet.Responses.$200>
  }
  ['/tokens/kms']: {
    /**
     * Tokens_request_Kms - Request a Petsem token for accessing KMS
     *
     * This site hosts documentation generated from the Fly.io Machines API OpenAPI specification. Visit our complete [Machines API docs](https://fly.io/docs/machines/api/apps-resource/) for details about using the Apps resource.
     */
    'post'(
      parameters?: Parameters<UnknownParamsObject> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.TokensRequestKms.Responses.$200>
  }
  ['/tokens/oidc']: {
    /**
     * Tokens_request_OIDC - Request an OIDC token
     *
     * Request an Open ID Connect token for your machine. Customize the audience claim with the `aud` parameter. This returns a JWT token. Learn more about [using OpenID Connect](/docs/reference/openid-connect/) on Fly.io.
     *
     */
    'post'(
      parameters?: Parameters<UnknownParamsObject> | null,
      data?: Paths.TokensRequestOIDC.RequestBody,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.TokensRequestOIDC.Responses.$200>
  }
  ['/v1/tokens/current']: {
    /**
     * CurrentToken_show - Get Current Token Information
     *
     * Get information about the current macaroon token(s), including organizations, apps, and whether each token is from a user or machine
     */
    'get'(
      parameters?: Parameters<UnknownParamsObject> | null,
      data?: any,
      config?: AxiosRequestConfig
    ): OperationResponse<Paths.CurrentTokenShow.Responses.$200>
  }
}

export type Client = OpenAPIClient<OperationMethods, PathsDictionary>

export type App = Components['Schemas']['App'];
export type AppOrganizationInfo = Components['Schemas']['AppOrganizationInfo'];
export type AppSecret = Components['Schemas']['AppSecret'];
export type AppSecrets = Components['Schemas']['AppSecrets'];
export type AppSecretsUpdateRequest = Components['Schemas']['AppSecretsUpdateRequest'];
export type AppSecretsUpdateResp = Components['Schemas']['AppSecretsUpdateResp'];
export type assignIPRequest = Components['Schemas']['AssignIPRequest'];
export type CheckStatus = Components['Schemas']['CheckStatus'];
export type CreateAppDeployTokenRequest = Components['Schemas']['CreateAppDeployTokenRequest'];
export type CreateAppRequest = Components['Schemas']['CreateAppRequest'];
export type CreateAppResponse = Components['Schemas']['CreateAppResponse'];
export type CreateLeaseRequest = Components['Schemas']['CreateLeaseRequest'];
export type CreateMachineRequest = Components['Schemas']['CreateMachineRequest'];
export type CreateOIDCTokenRequest = Components['Schemas']['CreateOIDCTokenRequest'];
export type CreateVolumeRequest = Components['Schemas']['CreateVolumeRequest'];
export type CurrentTokenResponse = Components['Schemas']['CurrentTokenResponse'];
export type DecryptSecretkeyRequest = Components['Schemas']['DecryptSecretkeyRequest'];
export type DecryptSecretkeyResponse = Components['Schemas']['DecryptSecretkeyResponse'];
export type DeleteAppSecretResponse = Components['Schemas']['DeleteAppSecretResponse'];
export type DeleteSecretkeyResponse = Components['Schemas']['DeleteSecretkeyResponse'];
export type EncryptSecretkeyRequest = Components['Schemas']['EncryptSecretkeyRequest'];
export type EncryptSecretkeyResponse = Components['Schemas']['EncryptSecretkeyResponse'];
export type ErrorResponse = Components['Schemas']['ErrorResponse'];
export type ExtendVolumeRequest = Components['Schemas']['ExtendVolumeRequest'];
export type ExtendVolumeResponse = Components['Schemas']['ExtendVolumeResponse'];
export type FlyContainerConfig = Components['Schemas']['FlyContainerConfig'];
export type FlyContainerDependency = Components['Schemas']['FlyContainerDependency'];
export type FlyContainerDependencyCondition = Components['Schemas']['FlyContainerDependencyCondition'];
export type FlyContainerHealthcheck = Components['Schemas']['FlyContainerHealthcheck'];
export type FlyContainerHealthcheckKind = Components['Schemas']['FlyContainerHealthcheckKind'];
export type FlyContainerHealthcheckScheme = Components['Schemas']['FlyContainerHealthcheckScheme'];
export type FlyDNSConfig = Components['Schemas']['FlyDNSConfig'];
export type FlyDnsForwardRule = Components['Schemas']['FlyDnsForwardRule'];
export type FlyDnsOption = Components['Schemas']['FlyDnsOption'];
export type FlyDuration = Components['Schemas']['FlyDuration'];
export type FlyEnvFrom = Components['Schemas']['FlyEnvFrom'];
export type FlyExecHealthcheck = Components['Schemas']['FlyExecHealthcheck'];
export type FlyFile = Components['Schemas']['FlyFile'];
export type FlyHTTPHealthcheck = Components['Schemas']['FlyHTTPHealthcheck'];
export type FlyHTTPOptions = Components['Schemas']['FlyHTTPOptions'];
export type FlyHTTPResponseOptions = Components['Schemas']['FlyHTTPResponseOptions'];
export type FlyMachineCheck = Components['Schemas']['FlyMachineCheck'];
export type FlyMachineConfig = Components['Schemas']['FlyMachineConfig'];
export type FlyMachineGuest = Components['Schemas']['FlyMachineGuest'];
export type FlyMachineHTTPHeader = Components['Schemas']['FlyMachineHTTPHeader'];
export type FlyMachineInit = Components['Schemas']['FlyMachineInit'];
export type FlyMachineMetrics = Components['Schemas']['FlyMachineMetrics'];
export type FlyMachineMount = Components['Schemas']['FlyMachineMount'];
export type FlyMachinePort = Components['Schemas']['FlyMachinePort'];
export type FlyMachineProcess = Components['Schemas']['FlyMachineProcess'];
export type FlyMachineRestart = Components['Schemas']['FlyMachineRestart'];
export type FlyMachineSecret = Components['Schemas']['FlyMachineSecret'];
export type FlyMachineService = Components['Schemas']['FlyMachineService'];
export type FlyMachineServiceCheck = Components['Schemas']['FlyMachineServiceCheck'];
export type FlyMachineServiceConcurrency = Components['Schemas']['FlyMachineServiceConcurrency'];
export type FlyProxyProtoOptions = Components['Schemas']['FlyProxyProtoOptions'];
export type FlyReplayCache = Components['Schemas']['FlyReplayCache'];
export type FlyStatic = Components['Schemas']['FlyStatic'];
export type FlyStopConfig = Components['Schemas']['FlyStopConfig'];
export type FlyTCPHealthcheck = Components['Schemas']['FlyTCPHealthcheck'];
export type FlyTLSOptions = Components['Schemas']['FlyTLSOptions'];
export type FlyUnhealthyPolicy = Components['Schemas']['FlyUnhealthyPolicy'];
export type Flydv1ExecResponse = Components['Schemas']['Flydv1ExecResponse'];
export type IPAssignment = Components['Schemas']['IPAssignment'];
export type ImageRef = Components['Schemas']['ImageRef'];
export type Lease = Components['Schemas']['Lease'];
export type ListAppsResponse = Components['Schemas']['ListAppsResponse'];
export type ListIPAssignmentsResponse = Components['Schemas']['ListIPAssignmentsResponse'];
export type ListenSocket = Components['Schemas']['ListenSocket'];
export type Machine = Components['Schemas']['Machine'];
export type MachineEvent = Components['Schemas']['MachineEvent'];
export type MachineExecRequest = Components['Schemas']['MachineExecRequest'];
export type MachineVersion = Components['Schemas']['MachineVersion'];
export type MainGetPlacementsRequest = Components['Schemas']['MainGetPlacementsRequest'];
export type MainGetPlacementsResponse = Components['Schemas']['MainGetPlacementsResponse'];
export type MainReclaimMemoryRequest = Components['Schemas']['MainReclaimMemoryRequest'];
export type MainReclaimMemoryResponse = Components['Schemas']['MainReclaimMemoryResponse'];
export type MainRegionResponse = Components['Schemas']['MainRegionResponse'];
export type MainStatusCode = Components['Schemas']['MainStatusCode'];
export type MainTokenInfo = Components['Schemas']['MainTokenInfo'];
export type PlacementRegionPlacement = Components['Schemas']['PlacementRegionPlacement'];
export type PlacementWeights = Components['Schemas']['PlacementWeights'];
export type ProcessStat = Components['Schemas']['ProcessStat'];
export type ReadsGetCapacityPerRegionRow = Components['Schemas']['ReadsGetCapacityPerRegionRow'];
export type SecretKey = Components['Schemas']['SecretKey'];
export type SecretKeys = Components['Schemas']['SecretKeys'];
export type SetAppSecretRequest = Components['Schemas']['SetAppSecretRequest'];
export type SetAppSecretResponse = Components['Schemas']['SetAppSecretResponse'];
export type SetSecretkeyRequest = Components['Schemas']['SetSecretkeyRequest'];
export type SetSecretkeyResponse = Components['Schemas']['SetSecretkeyResponse'];
export type SignSecretkeyRequest = Components['Schemas']['SignSecretkeyRequest'];
export type SignSecretkeyResponse = Components['Schemas']['SignSecretkeyResponse'];
export type SignalRequest = Components['Schemas']['SignalRequest'];
export type StopRequest = Components['Schemas']['StopRequest'];
export type UpdateMachineRequest = Components['Schemas']['UpdateMachineRequest'];
export type UpdateVolumeRequest = Components['Schemas']['UpdateVolumeRequest'];
export type VerifySecretkeyRequest = Components['Schemas']['VerifySecretkeyRequest'];
export type Volume = Components['Schemas']['Volume'];
export type VolumeSnapshot = Components['Schemas']['VolumeSnapshot'];

