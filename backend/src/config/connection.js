async function getUtcConnection(database) {
  const connection = await database.getConnection();
  try {
    await connection.query("SET time_zone = '+00:00'");
    return connection;
  } catch (error) {
    connection.release();
    throw error;
  }
}

module.exports = { getUtcConnection };
