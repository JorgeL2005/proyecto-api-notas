import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new LambdaClient({});
const NOTES_TABLE = "t_notas";

// Helper para validar el token
async function validateToken(token) {
  const params = {
    FunctionName: "ValidarTokenAcceso",
    Payload: JSON.stringify({ token }),
  };

  try {
    const result = await lambdaClient.send(new InvokeCommand(params));
    const rawPayload = new TextDecoder("utf-8").decode(result.Payload);
    const response = JSON.parse(rawPayload);

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
    console.error("Error en validateToken:", err);
    throw new Error(
      `Error validando el token: ${err.message || "Token inválido."}`
    );
  }
}

export const handler = async (event) => {
  try {
    // Validar el token
    const token = event.headers.Authorization.replace("Bearer ", "");
    const tokenData = await validateToken(token);
    const { role } = tokenData;

    // Validar permisos por rol (solo admin y teacher pueden eliminar)
    if (role !== "admin" && role !== "teacher") {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: "No tiene permisos para eliminar notas." }),
      };
    }

    // Parsear el cuerpo de la solicitud
    const body =
      typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    const { tenant_id, user_id, periodo, curso_id } = body;

    // Validar datos requeridos
    if (!tenant_id || !user_id || !periodo || !curso_id) {
      return {
        statusCode: 400,
        body: {
          error: "Faltan datos requeridos: tenant_id, user_id, periodo o curso_id.",
        },
      };
    }

    // Preparar la clave para eliminar
    const key = {
      "tenant_id#user_id": `${tenant_id}#${user_id}`,
      "periodo#curso_id": `${periodo}#${curso_id}`,
    };

    // Eliminar el registro en DynamoDB
    const deleteParams = {
      TableName: NOTES_TABLE,
      Key: key,
    };

    await docClient.send(new DeleteCommand(deleteParams));

    // Respuesta exitosa
    return {
      statusCode: 200,
      body: { message: "Nota eliminada exitosamente." },
    };
  } catch (err) {
    console.error("Error detectado en handler:", err);
    return {
      statusCode: 500,
      body: { error: err.message || "Error interno." },
    };
  }
};
