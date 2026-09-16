//! skald command-line driver.
//!
//! Usage:
//!   skald run <file.skc>      execute a compiled bytecode chunk
//!   skald lex <file>          tokenise a source file and print a token count
//!   skald json <file>         parse a JSON file and report validity
//!   skald validate <file>     load a chunk and audit its code
//!
//! The driver reads whole files into memory and never touches the network.

use std::env;
use std::fs;
use std::process::ExitCode;

fn usage() -> ExitCode {
    eprintln!("usage: skald <run|lex|json|validate> <file>");
    ExitCode::from(2)
}

fn read_file(path: &str) -> Option<Vec<u8>> {
    match fs::read(path) {
        Ok(b) => Some(b),
        Err(e) => {
            eprintln!("skald: cannot read {path}: {e}");
            None
        }
    }
}

fn cmd_run(path: &str) -> ExitCode {
    let Some(data) = read_file(path) else {
        return ExitCode::FAILURE;
    };
    let status = skald::vm::vm_exec(&data);
    println!("skald: vm exited with {status:?}");
    ExitCode::SUCCESS
}

fn cmd_lex(path: &str) -> ExitCode {
    let Some(data) = read_file(path) else {
        return ExitCode::FAILURE;
    };
    let count = skald::lexer::tokenize_all(&data);
    println!("skald: {count} tokens");
    ExitCode::SUCCESS
}

fn cmd_json(path: &str) -> ExitCode {
    let Some(data) = read_file(path) else {
        return ExitCode::FAILURE;
    };
    let err = skald::json::json_validate(&data);
    if err == skald::json::JsonError::Ok {
        println!("skald: valid JSON");
        let v = skald::json::json_parse(&data);
        skald::heap::heap_value_decref(v);
        ExitCode::SUCCESS
    } else {
        println!("skald: invalid JSON: {err:?}");
        ExitCode::FAILURE
    }
}

fn cmd_validate(path: &str) -> ExitCode {
    let Some(data) = read_file(path) else {
        return ExitCode::FAILURE;
    };
    match skald::bytecode::chunk_load(&data) {
        Some(chunk) => {
            println!(
                "skald: chunk ok — {} constants, {} functions, entry {}",
                chunk.constants.len(),
                chunk.funcs.len(),
                chunk.entry_idx
            );
            let flaws = skald::verify::chunk_verify(&chunk);
            if flaws.is_empty() {
                println!("skald: audit clean");
                return ExitCode::SUCCESS;
            }
            print!("{}", skald::verify::render(&flaws));
            println!("skald: {} flaws", flaws.len());
            ExitCode::FAILURE
        }
        None => {
            println!("skald: malformed chunk");
            ExitCode::FAILURE
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        return usage();
    }
    match args[1].as_str() {
        "run" => cmd_run(&args[2]),
        "lex" => cmd_lex(&args[2]),
        "json" => cmd_json(&args[2]),
        "validate" => cmd_validate(&args[2]),
        _ => usage(),
    }
}
