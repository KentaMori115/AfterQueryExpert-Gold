mod cli;
mod commands;
mod output;

use clap::Parser;
use serde::Serialize;

use cli::{Cli, Command};
use fwctl_core::{Config, FwctlError, Result};
use output::{Output, StdOutput};

fn main() {
    let cli = Cli::parse();
    let mut output = Output::stdio(cli.json, cli.quiet, cli.verbose);
    if let Err(err) = run(&cli, &mut output) {
        output.failure(&err);
        std::process::exit(exit_code(&err));
    }
}

fn run(cli: &Cli, output: &mut StdOutput) -> Result<()> {
    let config = Config::load(cli.config.as_deref())?;
    output.detail(format_args!("configuration loaded"))?;
    match &cli.command {
        Command::Version => {
            let version = VersionOutput {
                program: "fwctl",
                version: env!("CARGO_PKG_VERSION"),
            };
            output.success(&version, format_args!("fwctl {}", version.version))
        }
        Command::Package(args) => commands::package::create(args, output),
        Command::Inspect(args) => commands::package::inspect(args, output),
        Command::Verify(args) => commands::package::verify(args, &config, output),
        Command::Keys { action } => commands::keys::run(action, &config, output),
        Command::Devices => commands::device::list(cli.timeout, &config, output),
        Command::Info(args) => {
            commands::device::info(args, cli.device.as_deref(), cli.timeout, &config, output)
        }
        Command::Update(args) => {
            commands::update::run(args, cli.device.as_deref(), cli.timeout, &config, output)
        }
        Command::History(args) => commands::history::run(args, &config, output),
        Command::Status(args) => {
            commands::device::status(args, cli.device.as_deref(), cli.timeout, &config, output)
        }
        Command::Confirm(args) => {
            commands::device::confirm(args, cli.device.as_deref(), cli.timeout, &config, output)
        }
        Command::Rollback(args) => {
            commands::device::rollback(args, cli.device.as_deref(), cli.timeout, &config, output)
        }
        Command::Doctor => commands::doctor::run(&config, output),
    }
}

#[derive(Serialize)]
struct VersionOutput<'a> {
    program: &'a str,
    version: &'a str,
}

const fn exit_code(err: &FwctlError) -> i32 {
    use fwctl_core::ErrorCategory;

    match err.category() {
        ErrorCategory::PackageInvalid
        | ErrorCategory::SignatureInvalid
        | ErrorCategory::UnknownSigningKey
        | ErrorCategory::WrongProduct
        | ErrorCategory::UnsupportedHardwareRevision
        | ErrorCategory::DowngradeRejected
        | ErrorCategory::RollbackRejected => 3,
        ErrorCategory::DeviceNotFound => 4,
        ErrorCategory::ProtocolMismatch
        | ErrorCategory::TransportTimeout
        | ErrorCategory::TransportDisconnected => 5,
        ErrorCategory::FlashFailure
        | ErrorCategory::ImageVerificationFailed
        | ErrorCategory::RebootTimeout
        | ErrorCategory::HealthCheckFailed
        | ErrorCategory::AutomaticRollback => 6,
        ErrorCategory::Configuration | ErrorCategory::Io => 2,
    }
}
