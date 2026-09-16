//! Reserved keywords.

/// A recognized SQL keyword.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Keyword {
    Select,
    Distinct,
    From,
    Where,
    Group,
    By,
    Having,
    Order,
    Asc,
    Desc,
    Nulls,
    First,
    Last,
    Limit,
    Offset,
    Insert,
    Into,
    Values,
    Create,
    Table,
    Drop,
    If,
    Exists,
    As,
    Join,
    Inner,
    Left,
    Right,
    Full,
    Cross,
    Outer,
    On,
    Using,
    And,
    Or,
    Not,
    Null,
    True,
    False,
    Is,
    Between,
    In,
    Like,
    Cast,
    Case,
    Explain,
    When,
    Then,
    Else,
    End,
    // Type names
    Integer,
    Float,
    Text,
    Boolean,
}

impl Keyword {
    /// Map an already-upper-cased word to a keyword, if it is one.
    pub fn from_upper(word: &str) -> Option<Keyword> {
        let kw = match word {
            "SELECT" => Keyword::Select,
            "DISTINCT" => Keyword::Distinct,
            "FROM" => Keyword::From,
            "WHERE" => Keyword::Where,
            "GROUP" => Keyword::Group,
            "BY" => Keyword::By,
            "HAVING" => Keyword::Having,
            "ORDER" => Keyword::Order,
            "ASC" => Keyword::Asc,
            "DESC" => Keyword::Desc,
            "NULLS" => Keyword::Nulls,
            "FIRST" => Keyword::First,
            "LAST" => Keyword::Last,
            "LIMIT" => Keyword::Limit,
            "OFFSET" => Keyword::Offset,
            "INSERT" => Keyword::Insert,
            "INTO" => Keyword::Into,
            "VALUES" => Keyword::Values,
            "CREATE" => Keyword::Create,
            "TABLE" => Keyword::Table,
            "DROP" => Keyword::Drop,
            "IF" => Keyword::If,
            "EXISTS" => Keyword::Exists,
            "AS" => Keyword::As,
            "JOIN" => Keyword::Join,
            "INNER" => Keyword::Inner,
            "LEFT" => Keyword::Left,
            "RIGHT" => Keyword::Right,
            "FULL" => Keyword::Full,
            "CROSS" => Keyword::Cross,
            "OUTER" => Keyword::Outer,
            "ON" => Keyword::On,
            "USING" => Keyword::Using,
            "AND" => Keyword::And,
            "OR" => Keyword::Or,
            "NOT" => Keyword::Not,
            "NULL" => Keyword::Null,
            "TRUE" => Keyword::True,
            "FALSE" => Keyword::False,
            "IS" => Keyword::Is,
            "BETWEEN" => Keyword::Between,
            "IN" => Keyword::In,
            "LIKE" => Keyword::Like,
            "CAST" => Keyword::Cast,
            "CASE" => Keyword::Case,
            "EXPLAIN" => Keyword::Explain,
            "WHEN" => Keyword::When,
            "THEN" => Keyword::Then,
            "ELSE" => Keyword::Else,
            "END" => Keyword::End,
            "INTEGER" | "INT" => Keyword::Integer,
            "FLOAT" | "REAL" | "DOUBLE" => Keyword::Float,
            "TEXT" | "VARCHAR" | "STRING" => Keyword::Text,
            "BOOLEAN" | "BOOL" => Keyword::Boolean,
            _ => return None,
        };
        Some(kw)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_keywords_and_type_aliases() {
        assert_eq!(Keyword::from_upper("SELECT"), Some(Keyword::Select));
        assert_eq!(Keyword::from_upper("INT"), Some(Keyword::Integer));
        assert_eq!(Keyword::from_upper("VARCHAR"), Some(Keyword::Text));
        assert_eq!(Keyword::from_upper("BOOL"), Some(Keyword::Boolean));
        assert_eq!(Keyword::from_upper("widget"), None);
    }
}
