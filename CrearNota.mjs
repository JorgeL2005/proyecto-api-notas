import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new LambdaClient({});

const NOTES_TABLE = "t_notas";
const USERS_TABLE = "t_usuarios";

// Helper para validar el token usando la función Lambda
async function validateToken(token) {
  const params = {
    FunctionName: "ValidarTokenAcceso",
    Payload: JSON.stringify({ token }),
  };

  try {
    const result = await lambdaClient.send(new InvokeCommand(params));
    const response = JSON.parse(new TextDecoder("utf-8").decode(result.Payload));

    if (response.statusCode !== 200) {
      const errorBody =
        typeof response.body === "string"
          ? JSON.parse(response.body)
          : response.body;

      console.error("ValidarTokenAcceso Response:", errorBody);

      throw new Error(errorBody.error || "Token inválido o expirado.");
    }

    return typeof response.body === "string"
      ? JSON.parse(response.body)
      : response.body;
  } catch (err) {
    console.error("Error en validateToken:", err.message || err);
    throw new Error(`Error validando el token: ${err.message}`);
  }
}

// Helper para validar si el usuario es estudiante
async function validateStudent(tenantId, userId) {
  if (!tenantId || !userId) {
    throw new Error("Faltan parámetros requeridos: tenantId o userId.");
  }

  const compositeKey = `${tenantId}#${userId}`;
  const userParams = {
    TableName: USERS_TABLE,
    Key: {
      "tenant_id#user_id": compositeKey,
      "role": "student", // Clave de ordenación incluida
    },
  };

  try {
    const userResponse = await docClient.send(new GetCommand(userParams));

    if (!userResponse.Item) {
      throw new Error(`El usuario con clave ${compositeKey} no existe.`);
    }

    return userResponse.Item;
  } catch (err) {
    console.error("Error en validateStudent:", err.message || err);
    throw new Error(`Error validando el estudiante: ${err.message}`);
  }
}

export const handler = async (event) => {
  try {
    // Validar el token
    const token = event.headers.Authorization.replace("Bearer ", "");
    let tokenData;
    try {
      tokenData = await validateToken(token);
    } catch (err) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: err.message }),
      };
    }

    const { role } = tokenData;

    // Verificar el rol del usuario
    if (role !== "teacher" && role !== "admin") {
      return {
        statusCode: 403,
        body: JSON.stringify({
          error: "Solo los maestros o administradores pueden registrar notas.",
        }),
      };
    }

    // Manejar el cuerpo de la solicitud
    const body =
      typeof event.body === "string" ? JSON.parse(event.body) : event.body;

    const { tenant_id, user_id, curso_id, periodo, grade } = body;

    if (!tenant_id || !user_id || !curso_id || !periodo || grade === undefined) {
      return {
        statusCode: 400,
        body: {
          error:
            "Faltan datos requeridos: tenant_id, user_id, curso_id, periodo o grade.",
        },
      };
    }

    // Validar que el usuario es estudiante
    try {
      await validateStudent(tenant_id, user_id);
    } catch (err) {
      return {
        statusCode: 400,
        body: { error: err.message },
      };
    }

    // Crear la entrada para DynamoDB con atributos optimizados
    const noteData = {
      "tenant_id#user_id": `${tenant_id}#${user_id}`, // Clave primaria compuesta
      "periodo#curso_id": `${periodo}#${curso_id}`, // Clave de ordenación
      grade: grade, // Este campo es necesario para el índice
      RegisteredBy: tokenData.user_id, // Quién registró la nota
    };

    try {
      const putParams = {
        TableName: NOTES_TABLE,
        Item: noteData,
      };

      await docClient.send(new PutCommand(putParams));
    } catch (err) {
      console.error("Error al guardar en DynamoDB:", err.message || err);
      return {
        statusCode: 500,
        body: {
          error: "Error guardando la nota en la base de datos.",
        },
      };
    }

    return {
      statusCode: 201,
      body: { message: "Nota registrada exitosamente." },
    };
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
