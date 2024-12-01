import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const NOTES_TABLE = "t_notas";

// Helper para validar el token usando la función Lambda
async function validateToken(token) {
  const params = {
    FunctionName: "ValidarTokenAcceso",
    Payload: JSON.stringify({ token }),
  };

  try {
    const lambdaClient = new LambdaClient({});
    const result = await lambdaClient.send(new InvokeCommand(params));
    const response = JSON.parse(new TextDecoder("utf-8").decode(result.Payload));

    if (response.statusCode !== 200) {
      const errorBody =
        typeof response.body === "string"
          ? JSON.parse(response.body)
          : response.body;
      throw new Error(errorBody.error || "Token inválido o expirado.");
    }

    return typeof response.body === "string"
      ? JSON.parse(response.body)
      : response.body;
  } catch (err) {
    throw new Error(`Error validando el token: ${err.message}`);
  }
}

export const handler = async (event) => {
  try {
    // Validar el token
    const token = event.headers.Authorization.replace("Bearer ", "");
    const tokenData = await validateToken(token);

    const { role, tenant_id, user_id } = tokenData;

    // Verificar si el rol es válido
    if (role !== "student") {
      return {
        statusCode: 403,
        body: JSON.stringify({
          error: "Solo los estudiantes pueden consultar sus notas de un periodo.",
        }),
      };
    }

    // Parsear el cuerpo de la solicitud
    const body =
      typeof event.body === "string" ? JSON.parse(event.body) : event.body;

    const { periodo } = body;

    // Validar parámetros requeridos
    if (!periodo) {
      return {
        statusCode: 400,
        body: {
          error: "Falta el parámetro requerido: periodo.",
        },
      };
    }

    // Construir la consulta con KeyConditionExpression
    const queryCommandParams = {
      TableName: NOTES_TABLE,
      KeyConditionExpression: "#partitionKey = :partitionKey AND begins_with(#sortKey, :periodo)",
      ExpressionAttributeNames: {
        "#partitionKey": "tenant_id#user_id",
        "#sortKey": "periodo#curso_id",
      },
      ExpressionAttributeValues: {
        ":partitionKey": `${tenant_id}#${user_id}`,
        ":periodo": `${periodo}`,
      },
    };

    try {
      const result = await docClient.send(new QueryCommand(queryCommandParams));

      if (result.Items.length === 0) {
        return {
          statusCode: 404,
          body: {
            error: "No se encontraron notas para el periodo especificado.",
          },
        };
      }

      // Mapear las notas encontradas
      const notas = result.Items.map((item) => ({
        curso_id: item["periodo#curso_id"].split("#")[1], // Extraer curso_id del sort key
        grade: item.grade,
      }));

      return {
        statusCode: 200,
        body: { notas },
      };
    } catch (err) {
      console.error("Error al consultar las notas en DynamoDB:", err.message || err);
      return {
        statusCode: 500,
        body: {
          error: "Error al consultar las notas en la base de datos.",
        },
      };
    }
  } catch (err) {
    console.error("Error detectado en handler:", err.message || err);
    return {
      statusCode: 500,
      body: {
        error: err.message || "Error interno.",
      },
    };
  }
};
