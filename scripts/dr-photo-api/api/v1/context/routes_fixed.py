def extract_sender_info(email_address: str) -> Optional[Dict[str, Any]]:
    """
    Extract sender information from memory graph.

    Args:
        email_address: Sender email address

    Returns:
        Sender entity dict or None
    """
    graph = None
    try:
        graph = get_graph()
        graph.connect()

        # Try to find person by email
        # Query memory.nodes for person with email in properties
        with graph.conn.cursor() as cursor:
            cursor.execute("""
                SELECT id, node_type, label, properties
                FROM memory.nodes
                WHERE node_type = 'person'
                AND properties->>'email' = %s
                LIMIT 1
            """, (email_address,))

            result = cursor.fetchone()

            if result:
                return {
                    "id": str(result[0]),
                    "name": result[2],
                    "entity_type": result[1],
                    "properties": result[3] or {}
                }

        return None

    except Exception as e:
        logger.error(f"Error extracting sender info: {e}")
        return None

    finally:
        if graph:
            graph.close()
