import axios from "axios";
import { Request, Response } from "express";
import { db } from "../config/db";
import { STRIPE_SECRET_KEY } from "../constants/env";
import { PaymentStatus, OrderStatus } from "../models/IOrder";
import { IProduct } from "../models/IProduct";

const stripe = require("stripe")(STRIPE_SECRET_KEY);

interface ILineItem {
  price_data: {
    currency: string;
    product_data: {
      name: string;
      images?: string[];
      description: string;
    };
    unit_amount: number;
  };
  quantity: number;
}
interface IPayload {
  line_items: ILineItem[];
  order_id: number;
  metadata: metadata[];
}
interface metadata {
  product_id: number;
  quantity: number;
}

export const checkoutSessionHosted = async (req: Request, res: Response) => {};

export const checkoutSessionEmbedded = async (req: Request, res: Response) => {
  const { line_items, order_id, metadata }: IPayload = req.body.payload;
  const metadataString = JSON.stringify(metadata);

  const session = await stripe.checkout.sessions.create({
    line_items: line_items,
    metadata: {
      items: metadataString,
    },
    mode: "payment",
    ui_mode: "embedded",
    return_url: "http://localhost:5173/order-confirmation/{CHECKOUT_SESSION_ID}",
    client_reference_id: order_id,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 minutes
  });
  await axios.patch(
    `http://localhost:3000/orders/${order_id}`,
    {
      payment_id: session.id,
      payment_status: PaymentStatus.Unpaid,
      order_status: OrderStatus.Pending,
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
  res.send({ clientSecret: session.client_secret });
};

export const webhook = async (req: Request, res: Response) => {
  const event = req.body;
  // console.log("event:", event);

  // Handle the event
  const session = event.data.object;
  const { id, client_reference_id } = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
      await axios.patch(
        `http://localhost:3000/orders/${client_reference_id}`,
        {
          payment_id: id,
          payment_status: PaymentStatus.Paid,
          order_status: OrderStatus.Recieved,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const metadata = JSON.parse(session.metadata.items);
      metadata.forEach(async (item: metadata) => {
        const response = await axios.get(`http://localhost:3000/products/${item.product_id}`);
        const product: IProduct = response.data;
        product.stock -= item.quantity;

        await axios.patch(`http://localhost:3000/products/${item.product_id}`, product);
        console.log(`${item.product_id} updated`);
      });
      break;
    case "checkout.session.expired":
      console.log("Payment canceled");
      await axios.delete(`http://localhost:3000/orders/${client_reference_id}`, {
        headers: {
          "Content-Type": "application/json",
        },
      });
      break;
    default:
  }

  res.json({ received: true });
};
