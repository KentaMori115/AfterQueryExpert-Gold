//! Stack-based bytecode interpreter — a faithful port of `vm.c`.
//!
//! The VM owns a value stack and a fixed call-stack of frames. Object values on
//! the stack and in locals are reference-counted as they move; a GC scans the
//! stack and frame locals as roots. `vm_exec` is the top-level entry: load a
//! chunk, run it, tear the VM down.

use crate::bytecode::*;
use crate::gc::*;
use crate::heap::*;
use crate::value::Value;
use std::os::raw::c_void;

pub const VM_STACK_MAX: usize = 512;
pub const VM_LOCALS_MAX: usize = 96;
pub const VM_CALLSTACK_MAX: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VmStatus {
    Ok,
    StackOverflow,
    StackUnderflow,
    BadType,
    Undefined,
    DivZero,
    Index,
    CallDepth,
    BadOpcode,
    BadFunc,
    Oom,
}

#[derive(Clone, Copy)]
pub struct CallFrame {
    pub func_idx: u16,
    pub ip: u32,
    pub local_count: u8,
    pub locals: [Value; VM_LOCALS_MAX],
}

impl CallFrame {
    fn blank() -> CallFrame {
        CallFrame {
            func_idx: 0,
            ip: 0,
            local_count: 0,
            locals: [Value::Null; VM_LOCALS_MAX],
        }
    }
}

pub struct Vm {
    pub chunk: *const Chunk,
    pub stack: [Value; VM_STACK_MAX],
    pub stack_top: u32,
    pub call_stack: [CallFrame; VM_CALLSTACK_MAX],
    pub call_depth: i32,
    pub status: VmStatus,
    pub halted: bool,
    pub gc: GcPtr,
}

macro_rules! fail {
    ($vm:expr, $code:expr) => {{
        $vm.status = $code;
        return $code;
    }};
}

impl Vm {
    #[inline]
    unsafe fn chunk(&self) -> &Chunk {
        &*self.chunk
    }

    fn push(&mut self, v: Value) -> VmStatus {
        if self.stack_top as usize >= VM_STACK_MAX {
            fail!(self, VmStatus::StackOverflow);
        }
        heap_value_incref(v);
        self.stack[self.stack_top as usize] = v;
        self.stack_top += 1;
        VmStatus::Ok
    }

    fn pop(&mut self) -> Value {
        if self.stack_top == 0 {
            self.status = VmStatus::StackUnderflow;
            return Value::Null;
        }
        self.stack_top -= 1;
        self.stack[self.stack_top as usize]
    }

    fn peek(&mut self, offset: i32) -> Value {
        if self.stack_top as i32 - 1 - offset < 0 {
            self.status = VmStatus::StackUnderflow;
            return Value::Null;
        }
        self.stack[(self.stack_top as i32 - 1 - offset) as usize]
    }

    #[inline]
    fn frame(&mut self) -> &mut CallFrame {
        &mut self.call_stack[(self.call_depth - 1) as usize]
    }

    #[inline]
    unsafe fn frame_code_byte(&self, func_idx: u16, ip: u32) -> u8 {
        self.chunk().funcs[func_idx as usize].code[ip as usize]
    }

    /// Read the byte at the frame's instruction pointer and step past it.
    ///
    /// The dispatch loop bounds-checks the opcode byte, but an instruction's
    /// operand bytes can still run off the end of a truncated function. Those
    /// read as zero with `BadOpcode` latched, the same way a short pop reads
    /// as null, so a malformed program stops rather than indexing out of the
    /// code buffer.
    fn read_u8(&mut self) -> u8 {
        let d = self.call_depth;
        let f = &mut self.call_stack[(d - 1) as usize];
        let fi = f.func_idx;
        let ip = f.ip;
        f.ip += 1;
        let code_len = unsafe { self.chunk().funcs[fi as usize].code.len() as u32 };
        if ip >= code_len {
            self.status = VmStatus::BadOpcode;
            return 0;
        }
        unsafe { self.frame_code_byte(fi, ip) }
    }
    fn read_u16(&mut self) -> u16 {
        let lo = self.read_u8() as u16;
        let hi = self.read_u8() as u16;
        lo | (hi << 8)
    }
    fn read_i16(&mut self) -> i16 {
        self.read_u16() as i16
    }
    fn read_i32(&mut self) -> i32 {
        let mut v: u32 = 0;
        for i in 0..4 {
            v |= (self.read_u8() as u32) << (i * 8);
        }
        v as i32
    }

    fn frame_cleanup_locals(f: &mut CallFrame) {
        for i in 0..f.local_count as usize {
            heap_value_decref(f.locals[i]);
            f.locals[i] = Value::Null;
        }
    }

    fn stack_drain_to(&mut self, new_top: u32) {
        while self.stack_top > new_top {
            self.stack_top -= 1;
            let v = self.stack[self.stack_top as usize];
            heap_value_decref(v);
        }
    }

    fn push_frame(
        &mut self,
        func_idx: u16,
        arg_count: u8,
        captured: Value,
        has_captured: bool,
    ) -> VmStatus {
        if self.call_depth as usize >= VM_CALLSTACK_MAX {
            fail!(self, VmStatus::CallDepth);
        }
        let (param_count, local_count) = unsafe {
            let c = self.chunk();
            if func_idx as usize >= c.funcs.len() {
                fail!(self, VmStatus::BadFunc);
            }
            let func = &c.funcs[func_idx as usize];
            (func.param_count, func.local_count)
        };
        if arg_count != param_count {
            fail!(self, VmStatus::BadType);
        }

        let total = param_count as i32 + local_count as i32 + if has_captured { 1 } else { 0 };
        if total > VM_LOCALS_MAX as i32 {
            fail!(self, VmStatus::CallDepth);
        }

        let mut frame = CallFrame::blank();
        frame.func_idx = func_idx;
        frame.ip = 0;
        frame.local_count = total as u8;

        let mut base = 0usize;
        if has_captured {
            frame.locals[0] = captured;
            heap_value_incref(captured);
            base = 1;
        }
        // Pop args into place (reverse order). Done before frame is pushed so
        // pops observe the caller's stack.
        for i in (0..param_count as i32).rev() {
            let v = self.pop();
            frame.locals[base + i as usize] = v;
        }

        self.call_stack[self.call_depth as usize] = frame;
        self.call_depth += 1;
        VmStatus::Ok
    }

    fn pop_frame(&mut self) -> Value {
        let mut ret = Value::Null;
        if self.stack_top > 0 {
            ret = self.pop();
        }
        self.stack_drain_to(0);
        let d = self.call_depth;
        let mut f = self.call_stack[(d - 1) as usize];
        Vm::frame_cleanup_locals(&mut f);
        self.call_stack[(d - 1) as usize] = f;
        self.call_depth -= 1;
        ret
    }
}

// ── arithmetic helpers ──────────────────────────────────────────────────

fn val_add(a: Value, b: Value, st: &mut VmStatus) -> Value {
    if let (Value::Int(x), Value::Int(y)) = (a, b) {
        return Value::Int(x.wrapping_add(y));
    }
    if let (Some(fa), Some(fb)) = (a.as_float(), b.as_float()) {
        if a.is_obj() || b.is_obj() {
            *st = VmStatus::BadType;
            return Value::Null;
        }
        return Value::Float(fa + fb);
    }
    *st = VmStatus::BadType;
    Value::Null
}
fn val_sub(a: Value, b: Value, st: &mut VmStatus) -> Value {
    if let (Value::Int(x), Value::Int(y)) = (a, b) {
        return Value::Int(x.wrapping_sub(y));
    }
    if let (Some(fa), Some(fb)) = (a.as_float(), b.as_float()) {
        return Value::Float(fa - fb);
    }
    *st = VmStatus::BadType;
    Value::Null
}
fn val_mul(a: Value, b: Value, st: &mut VmStatus) -> Value {
    if let (Value::Int(x), Value::Int(y)) = (a, b) {
        return Value::Int(x.wrapping_mul(y));
    }
    if let (Some(fa), Some(fb)) = (a.as_float(), b.as_float()) {
        return Value::Float(fa * fb);
    }
    *st = VmStatus::BadType;
    Value::Null
}
fn val_div(a: Value, b: Value, st: &mut VmStatus) -> Value {
    if let Value::Int(0) = b {
        *st = VmStatus::DivZero;
        return Value::Null;
    }
    if let Value::Float(f) = b {
        if f == 0.0 {
            *st = VmStatus::DivZero;
            return Value::Null;
        }
    }
    match (a.as_float(), b.as_float()) {
        (Some(fa), Some(fb)) => Value::Float(fa / fb),
        _ => {
            *st = VmStatus::BadType;
            Value::Null
        }
    }
}
fn val_mod(a: Value, b: Value, st: &mut VmStatus) -> Value {
    match (a, b) {
        (Value::Int(_), Value::Int(0)) => {
            *st = VmStatus::DivZero;
            Value::Null
        }
        (Value::Int(x), Value::Int(y)) => Value::Int(x.wrapping_rem(y)),
        _ => {
            *st = VmStatus::BadType;
            Value::Null
        }
    }
}
fn val_eq(a: Value, b: Value) -> bool {
    a == b
}
fn val_lt(a: Value, b: Value, st: &mut VmStatus) -> bool {
    if let (Value::Int(x), Value::Int(y)) = (a, b) {
        return x < y;
    }
    if let (Some(fa), Some(fb)) = (a.as_float(), b.as_float()) {
        if !a.is_obj() && !b.is_obj() {
            return fa < fb;
        }
    }
    *st = VmStatus::BadType;
    false
}

// ── root scanning ───────────────────────────────────────────────────────

fn vm_gc_scan_roots(gc: GcPtr, user_data: *mut c_void) {
    unsafe {
        let vm = &*(user_data as *const Vm);
        for i in 0..vm.stack_top as usize {
            gc_mark_value(gc, vm.stack[i]);
        }
        for d in 0..vm.call_depth as usize {
            let f = &vm.call_stack[d];
            for i in 0..f.local_count as usize {
                gc_mark_value(gc, f.locals[i]);
            }
        }
    }
}

impl Vm {
    pub fn init(chunk: *const Chunk) -> Box<Vm> {
        let mut vm = Box::new(Vm {
            chunk,
            stack: [Value::Null; VM_STACK_MAX],
            stack_top: 0,
            call_stack: [CallFrame::blank(); VM_CALLSTACK_MAX],
            call_depth: 0,
            status: VmStatus::Ok,
            halted: false,
            gc: GcPtr::null(),
        });
        let gc = gc_create();
        vm.gc = gc;
        gc_set_threshold(gc, 4 * 1024);
        let vm_ptr: *mut Vm = &mut *vm;
        gc_set_root_scanner(gc, Some(vm_gc_scan_roots), vm_ptr as *mut c_void);
        heap_set_gc(gc);
        vm
    }

    fn obj_type_of(v: Value) -> Option<ObjType> {
        match v {
            Value::Obj(o) if !o.is_null() => Some(unsafe { (*o).obj_type }),
            _ => None,
        }
    }

    pub fn run(&mut self) -> VmStatus {
        let entry = unsafe { self.chunk().entry_idx };
        let s = self.push_frame(entry, 0, Value::Null, false);
        if s != VmStatus::Ok {
            return s;
        }

        while !self.halted && self.status == VmStatus::Ok && self.call_depth > 0 {
            let (fi, ip) = {
                let f = self.frame();
                (f.func_idx, f.ip)
            };
            let code_len = unsafe { self.chunk().funcs[fi as usize].code.len() as u32 };
            if ip >= code_len {
                let ret = self.pop_frame();
                if self.call_depth > 0 {
                    self.push(ret);
                } else {
                    heap_value_decref(ret);
                }
                continue;
            }

            let op = self.read_u8();
            match op {
                OP_NOP => {}
                OP_HALT => self.halted = true,
                OP_PUSH_CONST => {
                    let idx = self.read_u16();
                    let c = unsafe { self.chunk() };
                    if idx as usize >= c.constants.len() {
                        fail!(self, VmStatus::Undefined);
                    }
                    match c.constants[idx as usize].clone() {
                        Constant::Int(i) => {
                            self.push(Value::Int(i));
                        }
                        Constant::Float(f) => {
                            self.push(Value::Float(f));
                        }
                        Constant::Null => {
                            self.push(Value::Null);
                        }
                        Constant::Str(bytes) => {
                            let o = heap_new_string(&bytes);
                            if !self.gc.is_null() {
                                gc_track(self.gc, o);
                            }
                            self.push(Value::Obj(o));
                            heap_decref(o);
                        }
                    }
                }
                OP_PUSH_INT => {
                    let imm = self.read_i32();
                    self.push(Value::Int(imm as i64));
                }
                OP_PUSH_NULL => {
                    self.push(Value::Null);
                }
                OP_POP => {
                    let v = self.pop();
                    heap_value_decref(v);
                }
                OP_DUP => {
                    let v = self.peek(0);
                    self.push(v);
                }
                OP_LOAD => {
                    let idx = self.read_u8();
                    let f = self.frame();
                    if idx >= f.local_count {
                        fail!(self, VmStatus::Undefined);
                    }
                    let v = f.locals[idx as usize];
                    self.push(v);
                }
                OP_STORE => {
                    let idx = self.read_u8();
                    let lc = self.frame().local_count;
                    if idx >= lc {
                        fail!(self, VmStatus::Undefined);
                    }
                    let newv = self.pop();
                    let old = self.frame().locals[idx as usize];
                    heap_value_decref(old);
                    self.frame().locals[idx as usize] = newv;
                }
                OP_NEW_OBJ => {
                    let kind = self.read_u8();
                    let o = match kind {
                        0 => heap_new_dict(),
                        1 => heap_new_array(),
                        2 => heap_new_string(b""),
                        _ => fail!(self, VmStatus::BadOpcode),
                    };
                    if !self.gc.is_null() {
                        gc_track(self.gc, o);
                    }
                    self.push(Value::Obj(o));
                    heap_decref(o);
                }
                OP_ARRAY_PUSH => {
                    let item = self.pop();
                    let arr = self.peek(0);
                    if Vm::obj_type_of(arr) != Some(ObjType::Array) {
                        heap_value_decref(item);
                        fail!(self, VmStatus::BadType);
                    }
                    unsafe {
                        let a = SkObject::as_array_mut(arr.as_obj().unwrap()).unwrap();
                        array_push(a as *mut ObjArray, item);
                    }
                    heap_value_decref(item);
                }
                OP_ARRAY_GET => {
                    let idx = self.pop();
                    let arr = self.pop();
                    if Vm::obj_type_of(arr) != Some(ObjType::Array) || !idx.is_int() {
                        heap_value_decref(arr);
                        heap_value_decref(idx);
                        fail!(self, VmStatus::BadType);
                    }
                    let result = unsafe {
                        let a = SkObject::as_array_mut(arr.as_obj().unwrap()).unwrap();
                        array_get(a as *const ObjArray, idx.as_int().unwrap())
                    };
                    heap_value_decref(arr);
                    self.push(result);
                }
                OP_ARRAY_LEN => {
                    let arr = self.peek(0);
                    if Vm::obj_type_of(arr) != Some(ObjType::Array) {
                        fail!(self, VmStatus::BadType);
                    }
                    let len = unsafe {
                        let a = SkObject::as_array_mut(arr.as_obj().unwrap()).unwrap();
                        a.items.len() as i64
                    };
                    self.pop();
                    heap_value_decref(arr);
                    self.push(Value::Int(len));
                }
                OP_DICT_SET => {
                    let kidx = self.read_u16();
                    let key = match self.const_string(kidx) {
                        Some(k) => k,
                        None => fail!(self, VmStatus::BadType),
                    };
                    let val = self.pop();
                    let dict = self.peek(0);
                    if Vm::obj_type_of(dict) != Some(ObjType::Dict) {
                        heap_value_decref(val);
                        fail!(self, VmStatus::BadType);
                    }
                    unsafe {
                        let d = SkObject::as_dict_mut(dict.as_obj().unwrap()).unwrap();
                        dict_set(d as *mut ObjDict, &key, val);
                    }
                    heap_value_decref(val);
                }
                OP_DICT_GET => {
                    let kidx = self.read_u16();
                    let key = match self.const_string(kidx) {
                        Some(k) => k,
                        None => fail!(self, VmStatus::BadType),
                    };
                    let dict = self.pop();
                    if Vm::obj_type_of(dict) != Some(ObjType::Dict) {
                        heap_value_decref(dict);
                        fail!(self, VmStatus::BadType);
                    }
                    let result = unsafe {
                        let d = SkObject::as_dict_mut(dict.as_obj().unwrap()).unwrap();
                        dict_get(d as *const ObjDict, &key).unwrap_or(Value::Null)
                    };
                    heap_value_decref(dict);
                    self.push(result);
                }
                OP_CALL => {
                    let fidx = self.read_u16();
                    let arg_count = self.read_u8();
                    let ps = self.push_frame(fidx, arg_count, Value::Null, false);
                    if ps != VmStatus::Ok {
                        fail!(self, ps);
                    }
                }
                OP_RETURN => {
                    let ret = self.pop_frame();
                    if self.call_depth > 0 {
                        self.push(ret);
                    } else {
                        heap_value_decref(ret);
                        self.halted = true;
                    }
                }
                OP_NEW_CLOSURE => {
                    let fidx = self.read_u16();
                    let local = self.read_u8();
                    let f = self.frame();
                    if local >= f.local_count {
                        fail!(self, VmStatus::Undefined);
                    }
                    if fidx as usize >= unsafe { self.chunk().funcs.len() } {
                        fail!(self, VmStatus::BadFunc);
                    }
                    let captured = self.frame().locals[local as usize];
                    let cl = heap_new_closure(fidx, captured);
                    if !self.gc.is_null() {
                        gc_track(self.gc, cl);
                    }
                    self.push(Value::Obj(cl));
                    heap_decref(cl);
                }
                OP_INVOKE => {
                    let arg_count = self.read_u8();
                    if (self.stack_top as i32) < arg_count as i32 + 1 {
                        fail!(self, VmStatus::StackUnderflow);
                    }
                    let clv = self.stack[(self.stack_top - 1 - arg_count as u32) as usize];
                    if Vm::obj_type_of(clv) != Some(ObjType::Closure) {
                        fail!(self, VmStatus::BadType);
                    }
                    let (func_idx, captured) = unsafe {
                        let c = SkObject::as_closure(clv.as_obj().unwrap()).unwrap();
                        (c.func_idx, c.captured)
                    };
                    let base = (self.stack_top - 1 - arg_count as u32) as usize;
                    for i in base..(self.stack_top - 1) as usize {
                        self.stack[i] = self.stack[i + 1];
                    }
                    self.stack_top -= 1;
                    heap_value_decref(clv);
                    let ps = self.push_frame(func_idx, arg_count, captured, true);
                    if ps != VmStatus::Ok {
                        fail!(self, ps);
                    }
                }
                OP_ADD | OP_SUB | OP_MUL | OP_DIV | OP_MOD => {
                    let b = self.pop();
                    let a = self.pop();
                    let mut st = VmStatus::Ok;
                    let r = match op {
                        OP_ADD => val_add(a, b, &mut st),
                        OP_SUB => val_sub(a, b, &mut st),
                        OP_MUL => val_mul(a, b, &mut st),
                        OP_DIV => val_div(a, b, &mut st),
                        _ => val_mod(a, b, &mut st),
                    };
                    heap_value_decref(a);
                    heap_value_decref(b);
                    self.status = st;
                    if st != VmStatus::Ok {
                        continue;
                    }
                    self.push(r);
                }
                OP_EQ => {
                    let b = self.pop();
                    let a = self.pop();
                    let eq = val_eq(a, b);
                    heap_value_decref(a);
                    heap_value_decref(b);
                    self.push(Value::Int(eq as i64));
                }
                OP_LT => {
                    let b = self.pop();
                    let a = self.pop();
                    let mut st = VmStatus::Ok;
                    let lt = val_lt(a, b, &mut st);
                    heap_value_decref(a);
                    heap_value_decref(b);
                    self.status = st;
                    if st != VmStatus::Ok {
                        continue;
                    }
                    self.push(Value::Int(lt as i64));
                }
                OP_LE => {
                    let b = self.pop();
                    let a = self.pop();
                    let mut st = VmStatus::Ok;
                    let lt = val_lt(a, b, &mut st);
                    let eq = val_eq(a, b);
                    heap_value_decref(a);
                    heap_value_decref(b);
                    self.status = st;
                    if st != VmStatus::Ok {
                        continue;
                    }
                    self.push(Value::Int((lt || eq) as i64));
                }
                OP_NOT => {
                    let a = self.pop();
                    let z = a.is_null() || matches!(a, Value::Int(0));
                    heap_value_decref(a);
                    self.push(Value::Int(z as i64));
                }
                OP_NEG => {
                    let a = self.pop();
                    let r = match a {
                        Value::Int(i) => Value::Int(i.wrapping_neg()),
                        Value::Float(f) => Value::Float(-f),
                        _ => {
                            self.status = VmStatus::BadType;
                            Value::Null
                        }
                    };
                    heap_value_decref(a);
                    if self.status != VmStatus::Ok {
                        continue;
                    }
                    self.push(r);
                }
                OP_JMP => {
                    let off = self.read_i16();
                    let f = self.frame();
                    f.ip = (f.ip as i32 + off as i32) as u32;
                }
                OP_JMP_TRUE | OP_JMP_FALSE | OP_JMP_NULL => {
                    let off = self.read_i16();
                    let top = self.pop();
                    let take = match op {
                        OP_JMP_TRUE => !top.is_null() && !matches!(top, Value::Int(0)),
                        OP_JMP_FALSE => top.is_null() || matches!(top, Value::Int(0)),
                        _ => top.is_null(),
                    };
                    heap_value_decref(top);
                    if take {
                        let f = self.frame();
                        f.ip = (f.ip as i32 + off as i32) as u32;
                    }
                }
                OP_CONCAT => {
                    let b = self.pop();
                    let a = self.pop();
                    if Vm::obj_type_of(a) != Some(ObjType::String)
                        || Vm::obj_type_of(b) != Some(ObjType::String)
                    {
                        heap_value_decref(a);
                        heap_value_decref(b);
                        fail!(self, VmStatus::BadType);
                    }
                    let mut nd: Vec<u8> = Vec::new();
                    unsafe {
                        let sa = SkObject::as_string_mut(a.as_obj().unwrap()).unwrap();
                        let sb = SkObject::as_string_mut(b.as_obj().unwrap()).unwrap();
                        nd.extend_from_slice(&sa.data[..sa.len]);
                        nd.extend_from_slice(&sb.data[..sb.len]);
                    }
                    let r = heap_new_string(&nd);
                    heap_value_decref(a);
                    heap_value_decref(b);
                    if !self.gc.is_null() {
                        gc_track(self.gc, r);
                    }
                    self.push(Value::Obj(r));
                    heap_decref(r);
                }
                OP_PRINT => {
                    let top = self.pop();
                    heap_value_decref(top);
                }
                OP_TYPE_OF => {
                    let top = self.pop();
                    let name: &[u8] = match top {
                        Value::Null => b"null",
                        Value::Int(_) => b"int",
                        Value::Float(_) => b"float",
                        Value::Obj(o) => unsafe {
                            match (*o).obj_type {
                                ObjType::String => b"string",
                                ObjType::Array => b"array",
                                ObjType::Dict => b"dict",
                                ObjType::Closure => b"closure",
                            }
                        },
                    };
                    heap_value_decref(top);
                    let ns = heap_new_string(name);
                    if !self.gc.is_null() {
                        gc_track(self.gc, ns);
                    }
                    self.push(Value::Obj(ns));
                    heap_decref(ns);
                }
                OP_INCREF => {
                    let top = self.peek(0);
                    if let Value::Obj(o) = top {
                        heap_incref(o);
                    }
                }
                OP_DECREF => {
                    let top = self.pop();
                    if let Value::Obj(o) = top {
                        heap_decref(o);
                    }
                }
                OP_GC => {
                    if !self.gc.is_null() {
                        gc_collect(self.gc);
                    }
                }
                _ => fail!(self, VmStatus::BadOpcode),
            }
        }
        self.status
    }

    /// Fetch a constant-pool string as owned bytes, or `None` if not a string.
    fn const_string(&self, idx: u16) -> Option<Vec<u8>> {
        let c = unsafe { self.chunk() };
        match c.constants.get(idx as usize)? {
            Constant::Str(b) => Some(b.clone()),
            _ => None,
        }
    }

    pub fn cleanup(&mut self) {
        if !self.gc.is_null() {
            self.stack_top = 0;
            for d in 0..self.call_depth as usize {
                let f = &mut self.call_stack[d];
                for i in 0..f.local_count as usize {
                    f.locals[i] = Value::Null;
                }
            }
            gc_collect(self.gc);
            heap_set_gc(GcPtr::null());
            gc_destroy(self.gc);
            self.gc = GcPtr::null();
            self.call_depth = 0;
        }
    }
}

/// Top-level entry: load a chunk, run it, and tear the VM down.
pub fn vm_exec(data: &[u8]) -> VmStatus {
    let chunk = match chunk_load(data) {
        Some(c) => c,
        None => return VmStatus::Ok,
    };
    let chunk_ptr: *const Chunk = &chunk;
    let mut vm = Vm::init(chunk_ptr);
    let s = vm.run();
    vm.cleanup();
    s
}
