//! Directed weighted graph with common traversals — part of the `ds`
//! subsystem, mirroring `ds/graph` in the reference engine.
//!
//! Vertices are dense integer ids; edges carry an `i64` weight. Supports BFS,
//! DFS, Dijkstra shortest paths, topological sort, and connected-component
//! discovery.

use std::collections::{BinaryHeap, VecDeque};

pub struct Graph {
    adj: Vec<Vec<(usize, i64)>>,
    directed: bool,
}

impl Graph {
    pub fn new(num_vertices: usize, directed: bool) -> Graph {
        Graph {
            adj: vec![Vec::new(); num_vertices],
            directed,
        }
    }

    pub fn num_vertices(&self) -> usize {
        self.adj.len()
    }

    pub fn add_vertex(&mut self) -> usize {
        self.adj.push(Vec::new());
        self.adj.len() - 1
    }

    pub fn add_edge(&mut self, from: usize, to: usize, weight: i64) {
        if from >= self.adj.len() || to >= self.adj.len() {
            return;
        }
        self.adj[from].push((to, weight));
        if !self.directed {
            self.adj[to].push((from, weight));
        }
    }

    pub fn degree(&self, v: usize) -> usize {
        self.adj.get(v).map(|e| e.len()).unwrap_or(0)
    }

    pub fn neighbors(&self, v: usize) -> &[(usize, i64)] {
        self.adj.get(v).map(|e| e.as_slice()).unwrap_or(&[])
    }

    /// Breadth-first order starting from `start`.
    pub fn bfs(&self, start: usize) -> Vec<usize> {
        let n = self.adj.len();
        let mut visited = vec![false; n];
        let mut order = Vec::new();
        if start >= n {
            return order;
        }
        let mut q = VecDeque::new();
        visited[start] = true;
        q.push_back(start);
        while let Some(u) = q.pop_front() {
            order.push(u);
            for &(v, _) in &self.adj[u] {
                if !visited[v] {
                    visited[v] = true;
                    q.push_back(v);
                }
            }
        }
        order
    }

    /// Depth-first order starting from `start`.
    pub fn dfs(&self, start: usize) -> Vec<usize> {
        let n = self.adj.len();
        let mut visited = vec![false; n];
        let mut order = Vec::new();
        if start < n {
            self.dfs_rec(start, &mut visited, &mut order);
        }
        order
    }
    fn dfs_rec(&self, u: usize, visited: &mut [bool], order: &mut Vec<usize>) {
        visited[u] = true;
        order.push(u);
        for &(v, _) in &self.adj[u] {
            if !visited[v] {
                self.dfs_rec(v, visited, order);
            }
        }
    }

    /// Single-source shortest paths (Dijkstra) over non-negative weights.
    /// Returns the distance to each vertex; `i64::MAX` for unreachable.
    pub fn dijkstra(&self, src: usize) -> Vec<i64> {
        let n = self.adj.len();
        let mut dist = vec![i64::MAX; n];
        if src >= n {
            return dist;
        }
        dist[src] = 0;
        let mut heap = BinaryHeap::new();
        heap.push(std::cmp::Reverse((0i64, src)));
        while let Some(std::cmp::Reverse((d, u))) = heap.pop() {
            if d > dist[u] {
                continue;
            }
            for &(v, w) in &self.adj[u] {
                let nd = d.saturating_add(w);
                if nd < dist[v] {
                    dist[v] = nd;
                    heap.push(std::cmp::Reverse((nd, v)));
                }
            }
        }
        dist
    }

    /// Topological order for a DAG, or `None` if a cycle is present.
    pub fn topo_sort(&self) -> Option<Vec<usize>> {
        let n = self.adj.len();
        let mut indeg = vec![0usize; n];
        for u in 0..n {
            for &(v, _) in &self.adj[u] {
                indeg[v] += 1;
            }
        }
        let mut q: VecDeque<usize> = (0..n).filter(|&i| indeg[i] == 0).collect();
        let mut order = Vec::new();
        while let Some(u) = q.pop_front() {
            order.push(u);
            for &(v, _) in &self.adj[u] {
                indeg[v] -= 1;
                if indeg[v] == 0 {
                    q.push_back(v);
                }
            }
        }
        if order.len() == n {
            Some(order)
        } else {
            None
        }
    }

    /// Number of connected components (treats edges as undirected).
    pub fn connected_components(&self) -> usize {
        let n = self.adj.len();
        let mut visited = vec![false; n];
        let mut count = 0;
        for s in 0..n {
            if !visited[s] {
                count += 1;
                let mut stack = vec![s];
                visited[s] = true;
                while let Some(u) = stack.pop() {
                    for &(v, _) in &self.adj[u] {
                        if !visited[v] {
                            visited[v] = true;
                            stack.push(v);
                        }
                    }
                }
            }
        }
        count
    }
}
