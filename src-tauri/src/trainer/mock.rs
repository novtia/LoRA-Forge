/**
 * @file trainer/mock.rs
 * @description Mock 训练器：`run_mock_trainer_from_env()` 检测 CLI 参数，若命中则运行仿真训练进程并退出。
 *   用于 Tauri 自身进程以 `__mock_trainer` 子命令重新启动时充当轻量 Python stub。
 */
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};

use crate::error::{AppError, AppResult};

pub fn run_mock_trainer_from_env() -> bool {
    let args = std::env::args().collect::<Vec<_>>();
    if args.get(1).map(String::as_str) != Some("__mock_trainer") {
        return false;
    }
    if let Err(error) = run_mock_trainer(&args[2..]) {
        eprintln!("{error}");
        std::process::exit(1);
    }
    true
}

fn run_mock_trainer(args: &[String]) -> AppResult<()> {
    let project_name = required_arg(args, "--project-name")?;
    let output_dir = PathBuf::from(required_arg(args, "--output-dir")?);
    let control_file = PathBuf::from(required_arg(args, "--control-file")?);
    let epochs = required_arg(args, "--epochs")?
        .parse::<u32>()
        .map_err(|_| AppError::Process("Invalid epochs value".to_string()))?
        .max(1);
    let max_train_steps = required_arg(args, "--max-train-steps")?
        .parse::<u32>()
        .map_err(|_| AppError::Process("Invalid max-train-steps value".to_string()))?
        .max(1);
    let save_every = required_arg(args, "--save-every")?
        .parse::<u32>()
        .map_err(|_| AppError::Process("Invalid save-every value".to_string()))?;
    let learning_rate = required_arg(args, "--lr")?
        .parse::<f64>()
        .unwrap_or(0.00015);

    fs::create_dir_all(&output_dir)?;
    println!("INFO project={} trainer=boot", project_name);

    let total_steps = max_train_steps;
    let mut prev_epoch = 0_u32;
    let mut runtime_seconds = 0_u64;

    let write_checkpoint = |completed_epoch: u32| -> AppResult<()> {
        let checkpoint_path = output_dir.join(format!("epoch_{completed_epoch:02}.safetensors"));
        let mut checkpoint = fs::File::create(&checkpoint_path)?;
        writeln!(
            checkpoint,
            "mock checkpoint for {} at epoch {}",
            project_name, completed_epoch
        )?;
        println!(
            "CHECKPOINT epoch={} file={}",
            completed_epoch,
            checkpoint_path.display()
        );
        Ok(())
    };

    for step in 1..=total_steps {
        let epoch = 1_u32.saturating_add(
            (((step.saturating_sub(1)) as u64 * epochs as u64) / total_steps as u64) as u32,
        );
        loop {
            let control =
                read_control_state(&control_file).unwrap_or_else(|_| "running".to_string());
            match control.as_str() {
                "paused" => {
                    println!(
                        "INFO project={} status=paused epoch={}/{} step={}/{}",
                        project_name, epoch, epochs, step, total_steps
                    );
                    std::thread::sleep(Duration::from_millis(400));
                    runtime_seconds = runtime_seconds.saturating_add(1);
                    continue;
                }
                "aborted" => {
                    println!("WARN project={} trainer=aborted", project_name);
                    return Ok(());
                }
                _ => {}
            }
            break;
        }

        if epoch != prev_epoch {
            if prev_epoch > 0 && prev_epoch % save_every.max(1) == 0 {
                write_checkpoint(prev_epoch)?;
            }
            prev_epoch = epoch;
        }

        runtime_seconds = runtime_seconds.saturating_add(1);
        let progress = step as f64 / total_steps as f64;
        let loss = (0.19 - progress * 0.13).max(0.028);
        println!(
            "TRAIN epoch={}/{} step={}/{} loss={:.4} lr={} runtime={}",
            epoch, epochs, step, total_steps, loss, learning_rate, runtime_seconds
        );

        if step % 30 == 0 {
            eprintln!(
                "WARN project={} note=Disk cache warming step={}",
                project_name, step
            );
        }
        std::thread::sleep(Duration::from_millis(150));
    }

    if prev_epoch > 0 && prev_epoch % save_every.max(1) == 0 {
        write_checkpoint(prev_epoch)?;
    }
    println!("COMPLETE project={} status=completed", project_name);
    Ok(())
}

fn read_control_state(path: &Path) -> AppResult<String> {
    Ok(fs::read_to_string(path)?.trim().to_string())
}

fn required_arg(args: &[String], flag: &str) -> AppResult<String> {
    let index = args
        .iter()
        .position(|v| v == flag)
        .ok_or_else(|| AppError::Process(format!("Missing required flag '{flag}'")))?;
    args.get(index + 1)
        .cloned()
        .ok_or_else(|| AppError::Process(format!("Missing value for flag '{flag}'")))
}
